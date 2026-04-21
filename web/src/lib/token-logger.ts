import { prisma } from "./prisma";

interface TokenUsageParams {
  userId: string;
  projectId?: string;
  taskId?: string;
  provider: "seedance" | "gemini" | "gemini-canvas" | string;
  model: string;
  requestType: "storyboard_generation" | "video_generation" | "canvas_chat" | "canvas_image" | "canvas_image_edit" | string;
  inputTokens?: bigint;
  outputTokens?: bigint;
  totalTokens?: bigint;
  /** USD，写入 TokenUsageLog.costEstimate；为 null/undefined 时不写。 */
  costEstimate?: number | null;
  metadata?: object;
}

export async function logTokenUsage(params: TokenUsageParams) {
  try {
    await prisma.tokenUsageLog.create({
      data: {
        userId: params.userId,
        projectId: params.projectId ?? null,
        taskId: params.taskId ?? null,
        provider: params.provider,
        model: params.model,
        requestType: params.requestType,
        inputTokens: params.inputTokens ?? BigInt(0),
        outputTokens: params.outputTokens ?? BigInt(0),
        totalTokens: params.totalTokens ?? BigInt(0),
        costEstimate:
          typeof params.costEstimate === "number" && Number.isFinite(params.costEstimate)
            ? params.costEstimate
            : undefined,
        metadata: params.metadata as object ?? undefined,
      },
    });
  } catch (err) {
    console.error("[token-logger] Failed to log usage:", err);
  }
}
