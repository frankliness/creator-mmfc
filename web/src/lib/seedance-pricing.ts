/**
 * v1.9.0 Seedance Token 预估工具。
 *
 * 官方公式：
 *   estimated = ceil((inputDuration + outputDuration) * width * height * frameRate / 1024)
 *
 * 实际入账值取 API 返回 usage.total_tokens；预估值仅用于提交前预扣。
 */
import { prisma } from "./prisma";

const RATIO_TABLE: Record<string, [number, number]> = {
  // [longSide, shortSide] ratio numerators
  "9:16": [9, 16],
  "16:9": [16, 9],
  "1:1": [1, 1],
  "3:4": [3, 4],
  "4:3": [4, 3],
  "21:9": [21, 9],
  "9:21": [9, 21],
};

const RESOLUTION_SHORT_SIDE: Record<string, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
};

/**
 * 由 ratio + resolution 解析出输出视频 (width, height)。
 * 短边按 resolution 数值，长边按比例推算。竖屏 (9:16) 时短边=宽，长边=高。
 */
export function resolveOutputDimensions(
  ratio: string,
  resolution: string,
): { width: number; height: number } {
  const r = RATIO_TABLE[ratio] ?? [9, 16];
  const shortSide = RESOLUTION_SHORT_SIDE[resolution] ?? 720;
  // r[0]=width-component, r[1]=height-component (e.g., 9:16 -> w:9 h:16)
  const w = r[0];
  const h = r[1];
  if (w <= h) {
    // 竖屏或方形：宽是短边
    const width = shortSide;
    const height = Math.round((shortSide * h) / w);
    return { width, height };
  } else {
    // 横屏：高是短边
    const height = shortSide;
    const width = Math.round((shortSide * w) / h);
    return { width, height };
  }
}

export type SeedanceEstimateInput = {
  inputVideoDuration?: number;
  outputVideoDuration: number;
  ratio: string;
  resolution: string;
  frameRate?: number;
};

/** 官方公式：ceil((inputDuration + outputDuration) * w * h * fps / 1024) */
export function estimateSeedanceTokens(input: SeedanceEstimateInput): {
  width: number;
  height: number;
  frameRate: number;
  rawEstimateTokens: bigint;
} {
  const { width, height } = resolveOutputDimensions(input.ratio, input.resolution);
  const frameRate = input.frameRate ?? 24;
  const totalDuration = (input.inputVideoDuration ?? 0) + input.outputVideoDuration;
  const raw = Math.ceil((totalDuration * width * height * frameRate) / 1024);
  return {
    width,
    height,
    frameRate,
    rawEstimateTokens: BigInt(raw < 0 ? 0 : raw),
  };
}

/**
 * 查 ModelRegistry.capabilities.minimumTokenLimits 数组，匹配条件取 max。
 * limit entry 形如：
 *   { hasInputVideo?: boolean, ratio?: string, resolution?: string, outputDurationMin?: number, minTokens: number }
 * 匹配规则：所有指定字段都相等 / 满足；未指定字段视为通配。
 */
export async function applyMinimumLimit(
  modelKey: string,
  baseEstimate: bigint,
  hasInputVideo: boolean,
  context: { ratio: string; resolution: string; outputDuration: number },
): Promise<{ minimumTokenLimit: bigint | null; minimumLimitMatched: boolean; finalEstimateTokens: bigint }> {
  if (!hasInputVideo) {
    return {
      minimumTokenLimit: null,
      minimumLimitMatched: false,
      finalEstimateTokens: baseEstimate,
    };
  }
  const model = await prisma.modelRegistry.findFirst({
    where: { modelKey },
  });
  const caps = (model?.capabilities as { minimumTokenLimits?: unknown[] } | null) ?? null;
  const limits = Array.isArray(caps?.minimumTokenLimits) ? caps!.minimumTokenLimits : [];
  let best: bigint | null = null;
  let matched = false;
  for (const entry of limits) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      hasInputVideo?: boolean;
      ratio?: string;
      resolution?: string;
      outputDurationMin?: number;
      minTokens?: number | string;
    };
    if (typeof e.hasInputVideo === "boolean" && e.hasInputVideo !== hasInputVideo) continue;
    if (typeof e.ratio === "string" && e.ratio !== context.ratio) continue;
    if (typeof e.resolution === "string" && e.resolution !== context.resolution) continue;
    if (typeof e.outputDurationMin === "number" && context.outputDuration < e.outputDurationMin) continue;
    const min = typeof e.minTokens === "string" ? BigInt(e.minTokens) : BigInt(e.minTokens ?? 0);
    matched = true;
    if (best === null || min > best) best = min;
  }
  const final = best !== null && best > baseEstimate ? best : baseEstimate;
  return {
    minimumTokenLimit: best,
    minimumLimitMatched: matched,
    finalEstimateTokens: final,
  };
}

export type SeedanceEstimateSnapshot = {
  pricingFormula: string;
  inputVideoDuration: number;
  outputVideoDuration: number;
  outputVideoWidth: number;
  outputVideoHeight: number;
  outputVideoFrameRate: number;
  rawEstimateTokens: string;
  minimumTokenLimit: string | null;
  minimumLimitMatched: boolean;
  finalEstimateTokens: string;
  actualCompletionTokens: string | null;
  actualTotalTokens: string | null;
};

/** 构建提交前的预估快照，用于持久化到 TokenUsageLog.metadata。 */
export async function buildSeedanceEstimateSnapshot(args: {
  modelKey: string;
  inputVideoDuration?: number;
  outputVideoDuration: number;
  ratio: string;
  resolution: string;
  frameRate?: number;
}): Promise<{ snapshot: SeedanceEstimateSnapshot; finalEstimateTokens: bigint }> {
  const base = estimateSeedanceTokens({
    inputVideoDuration: args.inputVideoDuration,
    outputVideoDuration: args.outputVideoDuration,
    ratio: args.ratio,
    resolution: args.resolution,
    frameRate: args.frameRate,
  });
  const min = await applyMinimumLimit(
    args.modelKey,
    base.rawEstimateTokens,
    (args.inputVideoDuration ?? 0) > 0,
    {
      ratio: args.ratio,
      resolution: args.resolution,
      outputDuration: args.outputVideoDuration,
    },
  );
  return {
    finalEstimateTokens: min.finalEstimateTokens,
    snapshot: {
      pricingFormula:
        "(inputVideoDuration + outputVideoDuration) * outputVideoWidth * outputVideoHeight * outputVideoFrameRate / 1024",
      inputVideoDuration: args.inputVideoDuration ?? 0,
      outputVideoDuration: args.outputVideoDuration,
      outputVideoWidth: base.width,
      outputVideoHeight: base.height,
      outputVideoFrameRate: base.frameRate,
      rawEstimateTokens: base.rawEstimateTokens.toString(),
      minimumTokenLimit: min.minimumTokenLimit !== null ? min.minimumTokenLimit.toString() : null,
      minimumLimitMatched: min.minimumLimitMatched,
      finalEstimateTokens: min.finalEstimateTokens.toString(),
      actualCompletionTokens: null,
      actualTotalTokens: null,
    },
  };
}

/** 读取全局默认帧率（GlobalConfig.seedance_default_frame_rate）。 */
export async function getDefaultFrameRate(): Promise<number> {
  const cfg = await prisma.globalConfig.findUnique({
    where: { key: "seedance_default_frame_rate" },
  });
  const n = cfg ? Number(cfg.value) : 24;
  return Number.isFinite(n) && n > 0 ? n : 24;
}
