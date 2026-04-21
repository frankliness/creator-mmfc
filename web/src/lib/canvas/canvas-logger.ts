import { prisma } from "@/lib/prisma";
import { logTokenUsage } from "@/lib/token-logger";
import { logUserAction } from "@/lib/user-action-logger";
import { estimateChatCost, estimateImageCost } from "./cost-table";

export type CanvasCallType = "canvas_chat" | "canvas_image" | "canvas_image_edit";

export interface CanvasCallLogParams {
  userId: string;
  projectId: string | null;
  callType: CanvasCallType;
  model: string;
  inputTokens?: bigint;
  outputTokens?: bigint;
  totalTokens?: bigint;
  imageCount?: number;
  durationMs?: number;
  status: "success" | "failed";
  error?: string | null;
}

/**
 * 双写：
 *   - CanvasAiCall  ：画布维度精细审计（imageCount/durationMs）
 *   - TokenUsageLog ：复用现有 admin Token 报表（provider=gemini-canvas）
 *
 * 失败仅打日志、不抛出，避免影响主业务请求。
 */
export async function logCanvasCall(params: CanvasCallLogParams): Promise<void> {
  const inputTokens = params.inputTokens ?? BigInt(0);
  const outputTokens = params.outputTokens ?? BigInt(0);
  const totalTokens = params.totalTokens ?? inputTokens + outputTokens;
  const imageCount = params.imageCount ?? 0;

  let costEstimate: number | null = null;
  if (params.status === "success") {
    if (params.callType === "canvas_chat") {
      costEstimate = estimateChatCost(params.model, inputTokens, outputTokens);
    } else if (imageCount > 0) {
      costEstimate = estimateImageCost(params.model, imageCount);
    }
  }

  try {
    await prisma.canvasAiCall.create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        callType: params.callType,
        provider: "gemini-canvas",
        model: params.model,
        inputTokens,
        outputTokens,
        totalTokens,
        imageCount,
        durationMs: params.durationMs ?? null,
        status: params.status,
        error: params.error ?? null,
      },
    });
  } catch (err) {
    console.error("[canvas-logger] CanvasAiCall write failed:", err);
  }

  // TokenUsageLog 只记录有意义的成功调用（失败也写一条空记录会污染 token 报表）
  if (params.status === "success") {
    await logTokenUsage({
      userId: params.userId,
      projectId: params.projectId ?? undefined,
      provider: "gemini-canvas",
      model: params.model,
      requestType: params.callType,
      inputTokens,
      outputTokens,
      totalTokens,
      costEstimate,
      metadata: {
        imageCount,
        durationMs: params.durationMs,
      },
    });
  }

  await logUserAction({
    userId: params.userId,
    category: "canvas_ai",
    action: `${params.callType}.${params.status}`,
    targetType: "CanvasProject",
    targetId: params.projectId,
    projectId: params.projectId,
    route: params.callType === "canvas_chat" ? "/api/canvas/chat" : "/api/canvas/images",
    metadata: {
      model: params.model,
      status: params.status,
      error: params.error ?? null,
      imageCount,
      durationMs: params.durationMs ?? null,
      inputTokens: inputTokens.toString(),
      outputTokens: outputTokens.toString(),
      totalTokens: totalTokens.toString(),
    },
  });
}
