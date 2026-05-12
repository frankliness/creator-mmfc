import { prisma } from "@/lib/prisma";
import { getGlobalConfig } from "@/lib/global-config";

export const CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY = "canvas_image_global_concurrency";
export const CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY =
  "canvas_image_default_user_concurrency";
export const CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY = "canvas_image_task_timeout_ms";

const DEFAULT_GLOBAL_CONCURRENCY = 2;
const DEFAULT_USER_CONCURRENCY = 5;
const DEFAULT_TASK_TIMEOUT_MS = 600_000;

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
