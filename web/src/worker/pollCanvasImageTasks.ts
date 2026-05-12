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
  getCanvasImageUserShareCapPct,
  getCanvasImageZombieGraceMs,
  getUsersCanvasImageConcurrency,
} from "../lib/canvas/concurrency-config";

const PENDING_SCAN_LIMIT = parseInt(
  process.env.WORKER_CANVAS_IMAGE_PENDING_SCAN_LIMIT || "1500",
  10
);

/** 启动时回收上次进程残留的 RUNNING 行（崩溃 / kill -9 留下来的） */
export async function reclaimZombies(prisma: PrismaClient) {
  const [taskTimeoutMs, graceMs] = await Promise.all([
    getCanvasImageTaskTimeoutMs(),
    getCanvasImageZombieGraceMs(),
  ]);
  const cutoff = new Date(Date.now() - taskTimeoutMs - graceMs);
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

/** 每个 tick 兜底：把 RUNNING 超过 timeout + grace 的任务判 FAILED，释放槽位。 */
async function sweepTimedOutTasks(
  prisma: PrismaClient,
  taskTimeoutMs: number,
  graceMs: number
) {
  const cutoff = new Date(Date.now() - taskTimeoutMs - graceMs);
  const result = await prisma.canvasImageTask.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      error: `任务超过最长执行时间（${Math.round(taskTimeoutMs / 1000)}s），已自动失败`,
      finishedAt: new Date(),
    },
  });
  if (result.count > 0) {
    console.warn(`[canvas-image-worker] sweeper failed ${result.count} timed-out task(s)`);
  }
}

/** 单次 tick：先回收超时任务，再按剩余槽位启动 PENDING；不等待任务完成，下一 tick 持续补位。 */
export async function pollCanvasImageTasks(prisma: PrismaClient) {
  const [
    globalLimit,
    defaultUserLimit,
    taskTimeoutMs,
    graceMs,
    userSharePct,
  ] = await Promise.all([
    getCanvasImageGlobalConcurrency(),
    getCanvasImageDefaultUserConcurrency(),
    getCanvasImageTaskTimeoutMs(),
    getCanvasImageZombieGraceMs(),
    getCanvasImageUserShareCapPct(),
  ]);

  // tick 开头先扫一遍：把 timeout + grace 仍未结束的 RUNNING 任务判 FAILED，释放槽位。
  await sweepTimedOutTasks(prisma, taskTimeoutMs, graceMs);

  const [runningTotal, runningByUser] = await Promise.all([
    prisma.canvasImageTask.count({ where: { status: "RUNNING" } }),
    prisma.canvasImageTask.groupBy({
      by: ["userId"],
      where: { status: "RUNNING" },
      _count: { _all: true },
    }),
  ]);

  const availableGlobal = Math.max(0, globalLimit - runningTotal);
  if (availableGlobal === 0) return;

  // 单用户最多占用 globalLimit * userSharePct%，至少 1 个槽，防止一人独占全局。
  const userShareCap = Math.max(1, Math.floor((globalLimit * userSharePct) / 100));

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
    const effectiveLimit = Math.min(userLimit, userShareCap);
    if (userRunning >= effectiveLimit) continue;

    selected.push(task);
    runningCountByUser.set(task.userId, userRunning + 1);
  }

  if (selected.length === 0) return;

  console.log(
    `[canvas-image-worker] starting ${selected.length} task(s), global=${runningTotal + selected.length}/${globalLimit}, per-user-default=${defaultUserLimit}, user-share-cap=${userShareCap}`
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
