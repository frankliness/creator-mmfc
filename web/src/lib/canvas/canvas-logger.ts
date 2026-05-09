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
  /** 图片场景：aspect ratio (1:1/16:9 等)，用于精确估算 gpt-image-1 / DALL-E 3 价格 */
  size?: string;
  /** 图片场景：质量档（low/medium/high / standard/hd / 1K/2K/4K） */
  quality?: string;
  /** 实际使用的 provider 类型（openai / azure_openai / google）；不填则记 "gemini-canvas" 兼容旧报表 */
  upstreamProvider?: string;
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
      costEstimate = estimateImageCost(params.model, imageCount, params.size, params.quality);
    }
  }

  // provider 字段：保持 "gemini-canvas" 作为画布通道的稳定标识，避免破坏旧报表的过滤；
  // 实际上游 provider 写到 metadata.upstreamProvider 里供深度分析。
  const channelProvider = "gemini-canvas";

  try {
    await prisma.canvasAiCall.create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        callType: params.callType,
        provider: channelProvider,
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
      provider: channelProvider,
      model: params.model,
      requestType: params.callType,
      inputTokens,
      outputTokens,
      totalTokens,
      costEstimate,
      metadata: {
        imageCount,
        durationMs: params.durationMs,
        upstreamProvider: params.upstreamProvider ?? null,
        size: params.size ?? null,
        quality: params.quality ?? null,
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
