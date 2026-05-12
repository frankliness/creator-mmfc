/**
 * Worker loop: 画布图片异步任务（v1.5.0 起支持渠道轮询）
 *
 * 调度模式：
 *   - rotation_enabled=true（默认）：按 ProviderCredential.concurrency 在多个活跃凭据之间分发，
 *     "当前 RUNNING 最少的渠道优先"。命中 429 时 image-task-runner 写 cooldownUntil
 *     并把任务回退到 PENDING；本 tick 下次扫描时会自动跳过冷却中的渠道。
 *   - 任务 bypassRotation=true（用户级 UserApiConfig 或 rotation_enabled=false）走旧路径，
 *     只受 global+user 并发约束，不占渠道并发位。
 *
 * 抢占协议：
 *   - 渠道池路径：worker tick 直接做 PENDING → RUNNING 条件 update，并把 credentialId 一起写下去。
 *   - bypass 路径：保持 v1.4 行为，把 task 交给 runImageTask 内部抢占。
 *
 * 关于"重启时重跑"：进程崩溃留下的 RUNNING 行没人接管会僵尸态。
 * 做法是 mainLoop 启动时调一次 reclaimZombies()：把超过 RUNNING 阈值还没 finish 的任务标记 FAILED。
 *
 * NOTE: 单 worker 进程下并发计数走内存 + 单次 update 抢占。
 *       多实例水平扩展时此处会偏低导致超并发，届时改为 SELECT ... FOR UPDATE SKIP LOCKED
 *       或把 perCredRunning 计数挪到 Redis。
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { runImageTask } from "../lib/canvas/image-task-runner";
import {
  getCanvasImageDefaultUserConcurrency,
  getCanvasImageGlobalConcurrency,
  getCanvasImageTaskTimeoutMs,
  getCanvasImageUserShareCapPct,
  getCanvasImageZombieGraceMs,
  getUsersCanvasImageConcurrency,
  isCanvasImageRotationEnabled,
} from "../lib/canvas/concurrency-config";
import { credentialMatchesScope } from "../lib/llm/credential-resolver";
import type { Purpose } from "../lib/llm/types";

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

type PendingTaskLite = {
  id: string;
  userId: string;
  model: string;
  callType: string;
};

type CredentialLite = {
  id: string;
  purposes: Prisma.JsonValue;
  modelKeys: Prisma.JsonValue;
  concurrency: number;
  sortOrder: number;
  createdAt: Date;
};

/** 单次 tick：先回收超时任务，再按剩余槽位启动 PENDING；不等待任务完成，下一 tick 持续补位。 */
export async function pollCanvasImageTasks(prisma: PrismaClient) {
  const [
    rotationEnabled,
    globalLimit,
    defaultUserLimit,
    taskTimeoutMs,
    graceMs,
    userSharePct,
  ] = await Promise.all([
    isCanvasImageRotationEnabled(),
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

  let availableGlobal = Math.max(0, globalLimit - runningTotal);
  if (availableGlobal === 0) return;

  // 单用户最多占用 globalLimit * userSharePct%，至少 1 个槽，防止一人独占全局。
  const userShareCap = Math.max(1, Math.floor((globalLimit * userSharePct) / 100));

  const runningCountByUser = new Map(
    runningByUser.map((row) => [row.userId, row._count._all])
  );

  const launched: string[] = [];

  // bypass 任务不进渠道池抢占，沿用旧逻辑由 runImageTask 内部条件 update 抢占
  const bypassPending = await prisma.canvasImageTask.findMany({
    where: { status: "PENDING", bypassRotation: true },
    take: Math.max(PENDING_SCAN_LIMIT, availableGlobal * 50),
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, model: true, callType: true },
  }) as PendingTaskLite[];

  if (bypassPending.length > 0) {
    const bypassUserIds = [...new Set(bypassPending.map((t) => t.userId))];
    const userLimits = await getUsersCanvasImageConcurrency(bypassUserIds, defaultUserLimit);
    for (const task of bypassPending) {
      if (availableGlobal <= 0) break;
      const userRunning = runningCountByUser.get(task.userId) ?? 0;
      const userLimit = userLimits.get(task.userId) ?? defaultUserLimit;
      const effectiveLimit = Math.min(userLimit, userShareCap);
      if (userRunning >= effectiveLimit) continue;

      runningCountByUser.set(task.userId, userRunning + 1);
      availableGlobal -= 1;
      launched.push(task.id);
    }
  }

  // 渠道池路径：仅当 rotation 开启时
  if (rotationEnabled && availableGlobal > 0) {
    const launchedFromRotation = await schedulePooledTasks({
      prisma,
      availableGlobal,
      defaultUserLimit,
      userShareCap,
      runningCountByUser,
    });
    launched.push(...launchedFromRotation);
  } else if (!rotationEnabled && availableGlobal > 0) {
    // rotation 关闭：把非 bypass 的 PENDING 也按旧路径拉起（让历史任务能继续跑）
    const legacyPending = await prisma.canvasImageTask.findMany({
      where: { status: "PENDING", bypassRotation: false },
      take: Math.max(PENDING_SCAN_LIMIT, availableGlobal * 50),
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, model: true, callType: true },
    }) as PendingTaskLite[];
    if (legacyPending.length > 0) {
      const userIds = [...new Set(legacyPending.map((t) => t.userId))];
      const userLimits = await getUsersCanvasImageConcurrency(userIds, defaultUserLimit);
      for (const task of legacyPending) {
        if (availableGlobal <= 0) break;
        const userRunning = runningCountByUser.get(task.userId) ?? 0;
        const userLimit = userLimits.get(task.userId) ?? defaultUserLimit;
        const effectiveLimit = Math.min(userLimit, userShareCap);
        if (userRunning >= effectiveLimit) continue;
        runningCountByUser.set(task.userId, userRunning + 1);
        availableGlobal -= 1;
        launched.push(task.id);
      }
    }
  }

  if (launched.length === 0) return;

  console.log(
    `[canvas-image-worker] starting ${launched.length} task(s), rotation=${rotationEnabled}, global=${runningTotal + launched.length}/${globalLimit}, per-user-default=${defaultUserLimit}, user-share-cap=${userShareCap}`
  );

  for (const id of launched) {
    void (async () => {
      try {
        const result = await runImageTask(id);
        if (!result.ok && !result.raceLost) {
          console.warn(`[canvas-image-worker] task ${id} ended in failure`);
        }
      } catch (err) {
        console.error(`[canvas-image-worker] task ${id} unhandled error:`, err);
      }
    })();
  }
}

/**
 * 渠道池调度：把 PENDING 任务原子抢占到一条 (isActive 且未冷却) 的渠道。
 *
 * 返回成功抢占的 taskId 数组——worker 主循环用此调 runImageTask。
 */
async function schedulePooledTasks(args: {
  prisma: PrismaClient;
  availableGlobal: number;
  defaultUserLimit: number;
  userShareCap: number;
  runningCountByUser: Map<string, number>;
}): Promise<string[]> {
  const { prisma, availableGlobal, defaultUserLimit, userShareCap, runningCountByUser } = args;
  let remainingGlobal = availableGlobal;

  const now = new Date();
  const [credentials, runningByCredential] = await Promise.all([
    prisma.providerCredential.findMany({
      where: {
        isActive: true,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: now } }],
      },
      select: {
        id: true,
        purposes: true,
        modelKeys: true,
        concurrency: true,
        sortOrder: true,
        createdAt: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.canvasImageTask.groupBy({
      by: ["credentialId"],
      where: { status: "RUNNING", credentialId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  if (credentials.length === 0) return [];

  const perCredRunning = new Map<string, number>();
  for (const row of runningByCredential) {
    if (row.credentialId) perCredRunning.set(row.credentialId, row._count._all);
  }

  // 渠道池中至少要有一个有剩余位的渠道，否则就别拉 PENDING 了
  const initialRemaining = credentials.reduce((sum, c) => {
    const used = perCredRunning.get(c.id) ?? 0;
    return sum + Math.max(0, c.concurrency - used);
  }, 0);
  if (initialRemaining <= 0) return [];

  const pending = await prisma.canvasImageTask.findMany({
    where: { status: "PENDING", bypassRotation: false },
    take: Math.max(PENDING_SCAN_LIMIT, remainingGlobal * 50),
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, model: true, callType: true },
  }) as PendingTaskLite[];
  if (pending.length === 0) return [];

  const userIds = [...new Set(pending.map((task) => task.userId))];
  const userLimits = await getUsersCanvasImageConcurrency(userIds, defaultUserLimit);
  const launched: string[] = [];

  for (const task of pending) {
    if (remainingGlobal <= 0) break;
    const userRunning = runningCountByUser.get(task.userId) ?? 0;
    const userLimit = userLimits.get(task.userId) ?? defaultUserLimit;
    const effectiveLimit = Math.min(userLimit, userShareCap);
    if (userRunning >= effectiveLimit) continue;

    const picked = pickLeastLoadedCredential(
      credentials as CredentialLite[],
      perCredRunning,
      task.callType as Purpose,
      task.model
    );
    if (!picked) continue; // 该 model 当前没有可用渠道

    // 原子抢占：只有 status=PENDING 且 bypassRotation=false 才能改
    const claim = await prisma.canvasImageTask.updateMany({
      where: { id: task.id, status: "PENDING", bypassRotation: false },
      data: {
        status: "RUNNING",
        credentialId: picked.id,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 0) continue; // 被别的人抢走（或状态变了），不计入

    perCredRunning.set(picked.id, (perCredRunning.get(picked.id) ?? 0) + 1);
    runningCountByUser.set(task.userId, userRunning + 1);
    remainingGlobal -= 1;
    launched.push(task.id);
  }

  return launched;
}

/**
 * 在候选凭据里选"当前 RUNNING 最少 → sortOrder asc → createdAt asc"的一条。
 * 候选要求：
 *   - purposes 包含 task.callType
 *   - modelKeys 命中 task.model（modelKeys 为空表示全部模型）
 *   - 剩余并发 > 0
 */
function pickLeastLoadedCredential(
  credentials: CredentialLite[],
  perCredRunning: Map<string, number>,
  purpose: Purpose,
  modelKey: string
): CredentialLite | null {
  let best: CredentialLite | null = null;
  let bestRunning = Number.POSITIVE_INFINITY;

  for (const cred of credentials) {
    if (!credentialMatchesScope(cred, purpose, modelKey)) continue;
    const running = perCredRunning.get(cred.id) ?? 0;
    if (running >= cred.concurrency) continue;
    if (running < bestRunning) {
      best = cred;
      bestRunning = running;
    }
  }
  return best;
}
