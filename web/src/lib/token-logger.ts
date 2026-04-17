import { prisma } from "./prisma";

interface TokenUsageParams {
  userId: string;
  projectId?: string;
  taskId?: string;
  provider: "seedance" | "gemini" | string;
  model: string;
  requestType: "storyboard_generation" | "video_generation" | string;
  inputTokens?: bigint;
  outputTokens?: bigint;
  totalTokens?: bigint;
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
        metadata: params.metadata as object ?? undefined,
      },
    });
  } catch (err) {
    console.error("[token-logger] Failed to log usage:", err);
  }
}
