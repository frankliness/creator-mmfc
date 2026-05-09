/**
 * Worker loop: 画布图片异步任务（v1.4.0）
 *
 * 职责：
 *   - 每个 tick 拣最旧的若干 PENDING CanvasImageTask
 *   - 用 runImageTask 跑到终态（runImageTask 内部用条件 update 抢占）
 *   - 并发上限：避免一个用户 100 个任务把 worker 卡死
 *   - 单任务超时：交给 runImageTask 的 SINGLE_TASK_TIMEOUT_MS（10 分钟）
 *
 * 关于"重启时重跑"：进程崩溃留下的 RUNNING 行没人接管会僵尸态。
 * 做法是 mainLoop 启动时调一次 reclaimZombies()：把超过 RUNNING 阈值还没 finish 的任务标记 FAILED。
 */

import type { PrismaClient } from "@prisma/client";
import { runImageTask, SINGLE_TASK_TIMEOUT_MS } from "../lib/canvas/image-task-runner";

/** 同一时刻 worker 拉取/处理的任务上限。设大了会抢 CPU/网络，设小了堆积。 */
const CANVAS_IMAGE_BATCH = parseInt(process.env.WORKER_CANVAS_IMAGE_BATCH || "2", 10);

/** 僵尸阈值：RUNNING 超过 SINGLE_TASK_TIMEOUT_MS * 2 的任务就当作崩溃了 */
const ZOMBIE_THRESHOLD_MS = SINGLE_TASK_TIMEOUT_MS * 2;

/** 启动时回收上次进程残留的 RUNNING 行（崩溃 / kill -9 留下来的） */
export async function reclaimZombies(prisma: PrismaClient) {
  const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
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

/** 单次 tick：拉一批 PENDING，串行 runImageTask（runImageTask 内部已有抢占语义） */
export async function pollCanvasImageTasks(prisma: PrismaClient) {
  const pending = await prisma.canvasImageTask.findMany({
    where: { status: "PENDING" },
    take: CANVAS_IMAGE_BATCH,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (pending.length === 0) return;

  console.log(`[canvas-image-worker] picked ${pending.length} task(s)`);

  // 并发跑：限制由 CANVAS_IMAGE_BATCH 控制；runImageTask 内部互斥（条件 update 抢占）
  await Promise.all(
    pending.map(async ({ id }) => {
      try {
        const result = await runImageTask(id);
        if (!result.ok && !result.raceLost) {
          console.warn(`[canvas-image-worker] task ${id} ended in failure`);
        }
      } catch (err) {
        // runImageTask 应当已经吞掉自己的异常并写 task.error；这里兜底防御
        console.error(`[canvas-image-worker] task ${id} unhandled error:`, err);
      }
    })
  );
}
