import {
  estimateCostUSD,
  estimateImageCostUSD,
  getCapabilities,
} from "@/lib/llm/capabilities";

/**
 * 画布相关的费用预估单价（USD）。
 * 实现委托给 web/src/lib/llm/capabilities.ts 的统一价表，
 * 因此 OpenAI / Azure OpenAI / Gemini 系所有在表里登记的模型都能算出价格。
 *
 * 不在表内的 model 一律返回 null（不抛错），数据库 costEstimate 字段允许 NULL。
 */

export function estimateChatCost(
  model: string,
  totalTokensIn: bigint,
  totalTokensOut: bigint
): number | null {
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
export function estimateImageCost(
  model: string,
  imageCount: number,
  size?: string,
  quality?: string
): number | null {
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
