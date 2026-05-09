import type { ModelCapabilities } from './types'

/**
 * 模型能力表（Phase 1：代码常量；后续如需可移到 GlobalConfig.json）
 * 只列当前画布/分镜可能用到的模型。
 *
 * 价格单位：USD per 1M tokens；perImage 单位：USD/张
 * 数据来源：OpenAI 官方价格页 + Google AI Studio 公开定价（截至 2025-04）
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // ───────── OpenAI / Azure：文本/多模态 ─────────
  'gpt-4o': {
    maxContextTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  },
  'gpt-4o-mini': {
    maxContextTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  },
  'gpt-4.1': {
    maxContextTokens: 1_047_576,
    maxOutputTokens: 32_768,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
  },
  'gpt-4.1-mini': {
    maxContextTokens: 1_047_576,
    maxOutputTokens: 32_768,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6 },
  },
  o1: {
    maxContextTokens: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: true,
    supportsTools: false, // o1 不支持函数调用
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: false, // o1 不支持流式
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 15, outputPer1M: 60 },
  },
  'o3-mini': {
    maxContextTokens: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: false,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
  },

  // ───────── Gemini 文本（OpenAI 兼容端点 + 原生） ─────────
  'gemini-3-flash-preview': {
    maxContextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: false,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 0.075, outputPer1M: 0.3 },
  },
  'gemini-3-pro-preview': {
    maxContextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: false,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 1.25, outputPer1M: 5 },
  },
  'gemini-2.5-flash': {
    maxContextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: false,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 0.075, outputPer1M: 0.3 },
  },
  'gemini-2.5-pro': {
    maxContextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: false,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 1.25, outputPer1M: 5 },
  },
  'gemini-3.1-pro-preview': {
    maxContextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsTools: true,
    supportsJsonSchema: true,
    supportsJsonMode: false,
    supportsStreaming: true,
    supportsImageGen: false,
    supportsImageEdit: false,
    pricing: { inputPer1M: 1.25, outputPer1M: 5 },
  },

  // ───────── 图像生成 ─────────
  'dall-e-3': {
    maxContextTokens: 0,
    maxOutputTokens: 0,
    supportsVision: false,
    supportsTools: false,
    supportsJsonSchema: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    supportsImageGen: true,
    supportsImageEdit: false, // ⚠️ DALL-E 3 不支持参考图编辑
    imageSizeStyle: 'dalle3',
    pricing: {
      perImage: {
        '1024x1024_standard': 0.04,
        '1024x1024_hd': 0.08,
        '1024x1792_standard': 0.08,
        '1024x1792_hd': 0.12,
        '1792x1024_standard': 0.08,
        '1792x1024_hd': 0.12,
      },
    },
  },
  'gpt-image-1': {
    maxContextTokens: 0,
    maxOutputTokens: 0,
    supportsVision: false,
    supportsTools: false,
    supportsJsonSchema: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    supportsImageGen: true,
    supportsImageEdit: true, // ✅ 支持参考图编辑（多图输入）
    imageSizeStyle: 'gpt-image',
    pricing: {
      perImage: {
        low: 0.011,
        medium: 0.042,
        high: 0.167,
        auto: 0.042,
      },
    },
  },
  'gemini-3.1-flash-image-preview': {
    maxContextTokens: 0,
    maxOutputTokens: 0,
    supportsVision: false,
    supportsTools: false,
    supportsJsonSchema: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    supportsImageGen: true,
    supportsImageEdit: true, // Nano Banana 2 支持图生图
    imageSizeStyle: 'gemini',
    pricing: { perImage: { '1K': 0.039, '2K': 0.039, '4K': 0.039 } },
  },
  'gemini-3-pro-image-preview': {
    maxContextTokens: 0,
    maxOutputTokens: 0,
    supportsVision: false,
    supportsTools: false,
    supportsJsonSchema: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    supportsImageGen: true,
    supportsImageEdit: true, // Nano Banana Pro 支持图生图
    imageSizeStyle: 'gemini',
    pricing: { perImage: { '1K': 0.139, '2K': 0.139, '4K': 0.139 } },
  },
}

export function getCapabilities(model: string): ModelCapabilities | null {
  return MODEL_CAPABILITIES[model] ?? null
}

export function supportsImageEdit(model: string): boolean {
  return getCapabilities(model)?.supportsImageEdit ?? false
}

export function supportsImageGen(model: string): boolean {
  return getCapabilities(model)?.supportsImageGen ?? false
}

export function supportsJsonSchema(model: string): boolean {
  return getCapabilities(model)?.supportsJsonSchema ?? false
}

export function supportsStreaming(model: string): boolean {
  // 没在表里登记的模型默认假设支持流式（OpenAI 兼容默认 true）
  return getCapabilities(model)?.supportsStreaming ?? true
}

/**
 * 按 token 用量估算 USD 成本。
 * @param inputTokens 输入 token 总数（含可能的缓存命中部分）
 * @param outputTokens 输出 token
 * @param cachedInputTokens 命中缓存的 input token 数（OpenAI prompt cache / Gemini context cache）
 * @returns USD 数字；模型未登记或无价格返回 0
 */
export function estimateCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0
): number {
  const cap = getCapabilities(model)
  if (!cap?.pricing) return 0
  const { inputPer1M = 0, outputPer1M = 0, cachedInputPer1M = 0 } = cap.pricing
  const billableInput = Math.max(0, inputTokens - cachedInputTokens)
  const cost =
    (billableInput * inputPer1M +
      cachedInputTokens * cachedInputPer1M +
      outputTokens * outputPer1M) /
    1_000_000
  return Math.round(cost * 1e6) / 1e6 // 6 位小数精度
}

/** 按张图估算 USD 成本（DALL-E / gpt-image / Gemini Nano Banana） */
export function estimateImageCostUSD(
  model: string,
  options: { size?: string; quality?: string; count?: number } = {}
): number {
  const cap = getCapabilities(model)
  const perImage = cap?.pricing?.perImage
  if (!perImage) return 0

  const { size, quality, count = 1 } = options
  // 构造 key 顺序尝试：size_quality → quality → size
  const candidates = [
    size && quality ? `${size}_${quality}` : null,
    quality ?? null,
    size ?? null,
  ].filter((k): k is string => !!k)

  for (const key of candidates) {
    if (key in perImage) return perImage[key] * count
  }
  // 兜底取第一个
  const firstPrice = Object.values(perImage)[0]
  return firstPrice ? firstPrice * count : 0
}
