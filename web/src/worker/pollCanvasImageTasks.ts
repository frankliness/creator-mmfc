/**
 * Worker loop: 画布图片异步任务（v1.4.0）
 *
 * 职责：
 *   - 每个 tick 按全局/用户并发剩余槽位拣 PENDING CanvasImageTask
 *   - 用 runImageTask 跑到终态（runImageTask 内部用条件 update 抢占）
 *   - 并发上限：避免一个用户 100 个任务把 worker 卡死，同时保证多人公平启动
 *
 * 关于"重启时重跑"：进程崩溃留下的 RUNNING 行没人接管会僵尸态。
 * 做法是 mainLoop 启动时调一次 reclaimZombies()：把超过 RUNNING 阈值还没 finish 的任务标记 FAILED。
 */

import type { PrismaClient } from "@prisma/client";
import { runImageTask } from "../lib/canvas/image-task-runner";
import {
  getCanvasImageDefaultUserConcurrency,
  getCanvasImageGlobalConcurrency,
  getCanvasImageTaskTimeoutMs,
  getUsersCanvasImageConcurrency,
} from "../lib/canvas/concurrency-config";

const PENDING_SCAN_LIMIT = parseInt(
  process.env.WORKER_CANVAS_IMAGE_PENDING_SCAN_LIMIT || "1500",
  10
);

/** 启动时回收上次进程残留的 RUNNING 行（崩溃 / kill -9 留下来的） */
export async function reclaimZombies(prisma: PrismaClient) {
  const taskTimeoutMs = await getCanvasImageTaskTimeoutMs();
  const cutoff = new Date(Date.now() - taskTimeoutMs * 2);
  const result = await prisma.canvasImageTask.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null }],
    },
    data: {
      status: "FAILED",
      error: "worker 重启时检测到僵尸 RUNNING 状态，已自动失败（请重新生成）",
      finishedAt: new Date(),
    },
  });
  if (result.count > 0) {
    console.log(`[canvas-image-worker] reclaimed ${result.count} zombie tasks on startup`);
  }
}

/** 单次 tick：按剩余槽位启动 PENDING；不等待任务完成，下一 tick 持续补位。 */
export async function pollCanvasImageTasks(prisma: PrismaClient) {
  const [globalLimit, defaultUserLimit, runningTotal, runningByUser] =
    await Promise.all([
      getCanvasImageGlobalConcurrency(),
      getCanvasImageDefaultUserConcurrency(),
      prisma.canvasImageTask.count({ where: { status: "RUNNING" } }),
      prisma.canvasImageTask.groupBy({
        by: ["userId"],
        where: { status: "RUNNING" },
        _count: { _all: true },
      }),
    ]);

  const availableGlobal = Math.max(0, globalLimit - runningTotal);
  if (availableGlobal === 0) return;

  const pending = await prisma.canvasImageTask.findMany({
    where: { status: "PENDING" },
    take: Math.max(PENDING_SCAN_LIMIT, availableGlobal * 50),
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });

  if (pending.length === 0) return;

  const runningCountByUser = new Map(
    runningByUser.map((row) => [row.userId, row._count._all])
  );
  const userIds = [...new Set(pending.map((task) => task.userId))];
  const userLimits = await getUsersCanvasImageConcurrency(userIds, defaultUserLimit);
  const selected: Array<{ id: string; userId: string }> = [];

  for (const task of pending) {
    if (selected.length >= availableGlobal) break;
    const userRunning = runningCountByUser.get(task.userId) ?? 0;
    const userLimit = userLimits.get(task.userId) ?? defaultUserLimit;
    if (userRunning >= userLimit) continue;

    selected.push(task);
    runningCountByUser.set(task.userId, userRunning + 1);
  }

  if (selected.length === 0) return;

  console.log(
    `[canvas-image-worker] starting ${selected.length} task(s), global=${runningTotal + selected.length}/${globalLimit}, per-user-default=${defaultUserLimit}`
  );

  for (const { id } of selected) {
    void (async () => {
      try {
        const result = await runImageTask(id);
        if (!result.ok && !result.raceLost) {
          console.warn(`[canvas-image-worker] task ${id} ended in failure`);
        }
      } catch (err) {
        // runImageTask 应当已经吞掉自己的异常并写 task.error；这里兜底防御
        console.error(`[canvas-image-worker] task ${id} unhandled error:`, err);
      }
    })();
  }
}
