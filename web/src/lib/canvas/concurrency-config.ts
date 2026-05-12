import { prisma } from "@/lib/prisma";
import { getGlobalConfig } from "@/lib/global-config";

export const CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY = "canvas_image_global_concurrency";
export const CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY =
  "canvas_image_default_user_concurrency";
export const CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY = "canvas_image_task_timeout_ms";
export const CANVAS_IMAGE_USER_SHARE_CAP_PCT_KEY =
  "canvas_image_user_share_cap_pct";
export const CANVAS_IMAGE_ZOMBIE_GRACE_MS_KEY = "canvas_image_zombie_grace_ms";
export const CANVAS_IMAGE_ROTATION_ENABLED_KEY = "canvas_image_rotation_enabled";

const DEFAULT_GLOBAL_CONCURRENCY = 15;
const DEFAULT_USER_CONCURRENCY = 3;
const DEFAULT_TASK_TIMEOUT_MS = 1_800_000;
// 单用户最多占用全局并发的百分比上限（整数 1-100）。防止一个用户独占全局槽位。
const DEFAULT_USER_SHARE_CAP_PCT = 40;
// 任务超过 timeout 后再等多久判定为僵尸；同时作为前端 budget 与 sweeper 的统一缓冲。
const DEFAULT_ZOMBIE_GRACE_MS = 5 * 60_000;
const DEFAULT_ROTATION_ENABLED = true;

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function readIntInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = readPositiveInt(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export async function getCanvasImageGlobalConcurrency(): Promise<number> {
  return readPositiveInt(
    await getGlobalConfig(CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY),
    readPositiveInt(process.env.WORKER_CANVAS_IMAGE_GLOBAL_CONCURRENCY, DEFAULT_GLOBAL_CONCURRENCY)
  );
}

export async function getCanvasImageDefaultUserConcurrency(): Promise<number> {
  return readPositiveInt(
    await getGlobalConfig(CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY),
    readPositiveInt(
      process.env.WORKER_CANVAS_IMAGE_PER_USER_CONCURRENCY,
      DEFAULT_USER_CONCURRENCY
    )
  );
}

export async function getCanvasImageTaskTimeoutMs(): Promise<number> {
  return readPositiveInt(
    await getGlobalConfig(CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY),
    readPositiveInt(process.env.WORKER_CANVAS_IMAGE_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS)
  );
}

export async function getCanvasImageUserShareCapPct(): Promise<number> {
  return readIntInRange(
    await getGlobalConfig(CANVAS_IMAGE_USER_SHARE_CAP_PCT_KEY),
    1,
    100,
    readIntInRange(
      process.env.WORKER_CANVAS_IMAGE_USER_SHARE_CAP_PCT,
      1,
      100,
      DEFAULT_USER_SHARE_CAP_PCT
    )
  );
}

export async function getCanvasImageZombieGraceMs(): Promise<number> {
  return readPositiveInt(
    await getGlobalConfig(CANVAS_IMAGE_ZOMBIE_GRACE_MS_KEY),
    readPositiveInt(
      process.env.WORKER_CANVAS_IMAGE_ZOMBIE_GRACE_MS,
      DEFAULT_ZOMBIE_GRACE_MS
    )
  );
}

/**
 * 画布生图渠道轮询开关。
 *   - true（默认）：worker 按 ProviderCredential.concurrency 在多个渠道之间分发任务，命中 429 自动冷却
 *   - false：回退到 v1.4 行为，沿用 credential-resolver 选一条凭据，全任务受 global+user 并发约束
 *
 * 注：用户级 UserApiConfig 命中时任务被打 bypassRotation=true，不论本开关如何都不进渠道池。
 */
export async function isCanvasImageRotationEnabled(): Promise<boolean> {
  const raw = await getGlobalConfig(CANVAS_IMAGE_ROTATION_ENABLED_KEY);
  if (raw === undefined || raw === null) return DEFAULT_ROTATION_ENABLED;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (s === "false" || s === "0" || s === "off" || s === "no") return false;
  if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
  return DEFAULT_ROTATION_ENABLED;
}

export async function getUserCanvasImageConcurrency(
  userId: string,
  defaultLimit?: number
): Promise<number> {
  const fallback = defaultLimit ?? (await getCanvasImageDefaultUserConcurrency());
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quota: true },
  });
  const quota = user?.quota;
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) return fallback;
  return readPositiveInt(
    (quota as Record<string, unknown>).canvas_image_concurrency,
    fallback
  );
}

export async function getUsersCanvasImageConcurrency(
  userIds: string[],
  defaultLimit?: number
): Promise<Map<string, number>> {
  const fallback = defaultLimit ?? (await getCanvasImageDefaultUserConcurrency());
  if (userIds.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, quota: true },
  });

  const byUser = new Map<string, number>();
  for (const user of users) {
    const quota = user.quota;
    const limit =
      quota && typeof quota === "object" && !Array.isArray(quota)
        ? readPositiveInt(
            (quota as Record<string, unknown>).canvas_image_concurrency,
            fallback
          )
        : fallback;
    byUser.set(user.id, limit);
  }
  for (const id of userIds) {
    if (!byUser.has(id)) byUser.set(id, fallback);
  }
  return byUser;
}
