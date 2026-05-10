import {
  estimateCostUSD,
  estimateImageCostUSD,
  getCapabilities,
} from "@/lib/llm/capabilities";
import { prisma } from "@/lib/prisma";

/**
 * 画布相关的费用预估单价（USD）。
 * 优先读取 ModelRegistry.capabilities.pricing；未配置时 fallback 到
 * web/src/lib/llm/capabilities.ts 的统一价表。
 *
 * 不在表内的 model 一律返回 null（不抛错），数据库 costEstimate 字段允许 NULL。
 */

type RegistryPricing = {
  inputPer1M?: number;
  outputPer1M?: number;
  cachedInputPer1M?: number;
  perImage?: Record<string, number>;
};

async function getRegistryPricing(
  model: string,
  category: "chat" | "canvas_image" | "canvas_image_edit"
): Promise<RegistryPricing | null> {
  const entry = await prisma.modelRegistry.findUnique({
    where: { modelKey_category: { modelKey: model, category } },
    select: { capabilities: true },
  });
  const pricing =
    entry?.capabilities &&
    typeof entry.capabilities === "object" &&
    !Array.isArray(entry.capabilities) &&
    "pricing" in entry.capabilities
      ? (entry.capabilities as Record<string, unknown>).pricing
      : null;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return null;
  }
  return pricing as RegistryPricing;
}

export async function estimateChatCost(
  model: string,
  totalTokensIn: bigint,
  totalTokensOut: bigint
): Promise<number | null> {
  const registryPricing = await getRegistryPricing(model, "chat");
  if (
    registryPricing &&
    (registryPricing.inputPer1M != null || registryPricing.outputPer1M != null)
  ) {
    const inputCost =
      (Number(totalTokensIn) / 1_000_000) * (registryPricing.inputPer1M ?? 0);
    const outputCost =
      (Number(totalTokensOut) / 1_000_000) * (registryPricing.outputPer1M ?? 0);
    const cost = inputCost + outputCost;
    return Number.isFinite(cost) && cost > 0 ? cost : null;
  }

  const cap = getCapabilities(model);
  if (!cap?.pricing || (cap.pricing.inputPer1M == null && cap.pricing.outputPer1M == null)) {
    return null;
  }
  const cost = estimateCostUSD(model, Number(totalTokensIn), Number(totalTokensOut));
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * 图片成本估算。
 * @param size 例如 "1:1" / "16:9"（前端发来的 aspect ratio key）
 * @param quality 例如 "standard" / "hd" / "low" / "medium" / "high" / "auto" / "1K" / "2K" / "4K"
 *
 * 不传 size/quality 时退回到模型 perImage 价表的第一档（粗略估算）。
 */
export async function estimateImageCost(
  model: string,
  imageCount: number,
  size?: string,
  quality?: string,
  category: "canvas_image" | "canvas_image_edit" = "canvas_image"
): Promise<number | null> {
  const registryPricing = await getRegistryPricing(model, category);
  if (registryPricing?.perImage) {
    const unit = pickPerImagePrice(registryPricing.perImage, model, size, quality);
    const cost = unit == null ? null : unit * Math.max(0, imageCount);
    return cost != null && Number.isFinite(cost) && cost > 0 ? cost : null;
  }

  const cap = getCapabilities(model);
  if (!cap?.pricing?.perImage) return null;

  // 按 capabilities.ts 的 estimateImageCostUSD 优先匹配 size_quality / quality / size
  // DALL-E 3 价格 key 形如 "1024x1024_hd"；gpt-image-1 形如 "high"；Gemini 形如 "1K"
  // 我们这里把前端的 aspect ratio 映射为像素 size 试一下
  const pixelSize = aspectToPixelSize(size, model);
  const cost = estimateImageCostUSD(model, {
    size: pixelSize,
    quality,
    count: Math.max(0, imageCount),
  });
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

function pickPerImagePrice(
  perImage: Record<string, number>,
  model: string,
  size?: string,
  quality?: string
): number | null {
  const pixelSize = aspectToPixelSize(size, model);
  const candidates = [
    pixelSize && quality ? `${pixelSize}_${quality}` : null,
    quality ?? null,
    pixelSize ?? null,
  ].filter(Boolean) as string[];

  for (const key of candidates) {
    const value = perImage[key];
    if (typeof value === "number") return value;
  }

  const first = Object.values(perImage).find((value) => typeof value === "number");
  return first ?? null;
}

/** 把 "1:1" / "16:9" 这类 aspect ratio 映射成 DALL-E 3 风格的像素串 */
function aspectToPixelSize(aspect: string | undefined, model: string): string | undefined {
  if (!aspect) return undefined;
  // gpt-image-1 用不同尺寸枚举；DALL-E 3 用 1024x1024 / 1792x1024 / 1024x1792
  const isGptImage = /^gpt-image-/i.test(model);
  const isDalle = /^dall-e-/i.test(model);
  if (!isGptImage && !isDalle) return undefined; // Gemini 价表是按 quality 匹配的

  const dalleMap: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
    "21:9": "1792x1024",
    "4:3": "1024x1024",
    "3:2": "1792x1024",
    "2:3": "1024x1792",
    "3:4": "1024x1792",
  };
  const gptImageMap: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "21:9": "1536x1024",
    "4:3": "1536x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "3:4": "1024x1536",
  };
  return (isGptImage ? gptImageMap : dalleMap)[aspect] ?? undefined;
}
