import { prisma } from "@/lib/prisma";

/**
 * User.quota 中支持的 canvas 配额字段（均为可选）：
 *   {
 *     "daily_image_limit":  number,   // 每日生图次数上限
 *     "daily_chat_tokens":  number    // 每日聊天 totalTokens 上限
 *   }
 * 缺失则不限制。
 */
export interface CanvasQuotaSnapshot {
  imageLimit: number | null;
  imageUsed: number;
  chatTokenLimit: number | null;
  chatTokenUsed: number;
}

function startOfTodayUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function readNumber(quota: unknown, key: string): number | null {
  if (!quota || typeof quota !== "object") return null;
  const value = (quota as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
}

export async function getCanvasQuotaSnapshot(userId: string): Promise<CanvasQuotaSnapshot> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quota: true },
  });

  const imageLimit = readNumber(user?.quota, "daily_image_limit");
  const chatTokenLimit = readNumber(user?.quota, "daily_chat_tokens");

  const since = startOfTodayUTC();
  const callsToday = await prisma.canvasAiCall.findMany({
    where: { userId, createdAt: { gte: since }, status: "success" },
    select: { callType: true, imageCount: true, totalTokens: true },
  });

  let imageUsed = 0;
  let chatTokenUsed = 0;
  for (const c of callsToday) {
    if (c.callType === "canvas_image" || c.callType === "canvas_image_edit") {
      imageUsed += c.imageCount || 1;
    }
    if (c.callType === "canvas_chat") {
      chatTokenUsed += Number(c.totalTokens ?? BigInt(0));
    }
  }

  return { imageLimit, imageUsed, chatTokenLimit, chatTokenUsed };
}

export type QuotaCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function checkImageQuota(userId: string, imagesPlanned = 1): Promise<QuotaCheckResult> {
  const snap = await getCanvasQuotaSnapshot(userId);
  if (snap.imageLimit !== null && snap.imageUsed + imagesPlanned > snap.imageLimit) {
    return {
      ok: false,
      reason: `今日生图配额已达上限 (${snap.imageUsed}/${snap.imageLimit})`,
    };
  }
  return { ok: true };
}

export async function checkChatQuota(userId: string): Promise<QuotaCheckResult> {
  const snap = await getCanvasQuotaSnapshot(userId);
  if (snap.chatTokenLimit !== null && snap.chatTokenUsed >= snap.chatTokenLimit) {
    return {
      ok: false,
      reason: `今日聊天 token 配额已达上限 (${snap.chatTokenUsed}/${snap.chatTokenLimit})`,
    };
  }
  return { ok: true };
}
