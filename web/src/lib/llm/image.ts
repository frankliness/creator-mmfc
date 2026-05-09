import type { ProviderConfig } from './types'
import {
  generateGeminiImage,
  type GeminiImageRefPart,
  type GeminiImageResult,
  type GeminiUsage,
} from '@/lib/canvas/gemini-image'

export type ImageResult = GeminiImageResult

export interface ImageInput {
  /** 前端选择的模型名（gpt-image-1 / dall-e-3 / gemini-* 等） */
  model: string
  prompt: string
  /** Gemini 风格 "1:1" / "16:9" 等 */
  aspectRatio?: string
  /** Gemini "1K"/"2K"/"4K"，OpenAI 系映射成 quality */
  imageSize?: string
  refImages?: GeminiImageRefPart[]
  /** 是否走图生图（image edit）路径，由路由根据 refImages 推断后传入 */
  isEdit?: boolean
}

const ZERO = BigInt(0)

// ─────────── 模型家族判定 ───────────
function isGptImage(model: string): boolean {
  return /^gpt-image-/i.test(model) // 匹配 gpt-image-1 / gpt-image-2 / ...
}
function isDalle(model: string): boolean {
  return /^dall-e-/i.test(model)
}

// ─────────── 尺寸映射 ───────────
/** Gemini aspect ratio → DALL-E 3 size（仅 3 档） */
const DALLE3_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '21:9': '1792x1024',
  '4:3': '1024x1024',
  '3:2': '1792x1024',
  '2:3': '1024x1792',
  '3:4': '1024x1792',
  '9:16': '1024x1792',
}

/** Gemini aspect ratio → gpt-image-1 size（3 档不同于 DALL-E 3） */
const GPT_IMAGE_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '21:9': '1536x1024',
  '4:3': '1536x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '9:16': '1024x1536',
}

/** Gemini quality 词 → gpt-image quality 词 */
function toGptImageQuality(imageSize?: string): 'low' | 'medium' | 'high' | 'auto' {
  switch (imageSize) {
    case '1K':
    case 'low':
      return 'low'
    case '2K':
    case 'medium':
      return 'medium'
    case '4K':
    case 'high':
      return 'high'
    default:
      return 'auto'
  }
}

// ─────────── URL 构造（Azure / OpenAI / Custom） ───────────
function buildImageEndpoint(
  config: ProviderConfig,
  requestModel: string,
  endpoint: 'generations' | 'edits'
): { url: string; authHeaders: Record<string, string> } {
  const base = config.baseUrl.replace(/\/+$/, '')

  if (config.provider === 'azure_openai') {
    const version = config.apiVersion ?? '2024-08-01-preview'
    const deployment = config.deployment || requestModel
    return {
      url: `${base}/openai/deployments/${encodeURIComponent(deployment)}/images/${endpoint}?api-version=${version}`,
      authHeaders: { 'api-key': config.apiKey },
    }
  }

  // openai / custom
  return {
    url: `${base}/images/${endpoint}`,
    authHeaders: { Authorization: `Bearer ${config.apiKey}` },
  }
}

// ─────────── 主入口 ───────────
export async function generateProviderImage(
  config: ProviderConfig,
  input: ImageInput
): Promise<ImageResult> {
  // Google 原生 Gemini 图像 API（含图生图，多图输入）
  if (config.provider === 'google') {
    return generateGeminiImage({
      model: input.model,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      refImages: input.refImages,
    })
  }

  // OpenAI / Azure / Custom
  if (isGptImage(input.model)) {
    return input.isEdit && input.refImages?.length
      ? generateGptImageEdit(config, input)
      : generateGptImageGen(config, input)
  }
  if (isDalle(input.model)) {
    if (input.isEdit && input.refImages?.length) {
      throw new Error(
        'DALL-E 3 不支持图生图（image edit），请改用 gpt-image-1 或 Gemini Nano Banana 系列'
      )
    }
    return generateDalle3(config, input)
  }

  // 未知模型：按 OpenAI 标准 /images/generations 兜底
  return generateDalle3(config, input)
}

// ─────────── DALL-E 3 文生图 ───────────
async function generateDalle3(config: ProviderConfig, input: ImageInput): Promise<ImageResult> {
  const size = DALLE3_SIZE_MAP[input.aspectRatio ?? '1:1'] ?? '1024x1024'
  const quality = input.imageSize === '1K' || input.imageSize === 'standard' ? 'standard' : 'hd'

  const body: Record<string, unknown> = {
    prompt: input.prompt,
    n: 1,
    size,
    quality,
    response_format: 'b64_json',
  }
  // Azure 用 deployment URL，body 的 model 字段冗余且部分版本会校验，故省略
  if (config.provider !== 'azure_openai') body.model = input.model

  const { url, authHeaders } = buildImageEndpoint(config, input.model, 'generations')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  })
  return parseOpenAIImageResponse(res)
}

// ─────────── gpt-image 文生图 ───────────
async function generateGptImageGen(
  config: ProviderConfig,
  input: ImageInput
): Promise<ImageResult> {
  const size = GPT_IMAGE_SIZE_MAP[input.aspectRatio ?? '1:1'] ?? '1024x1024'
  const quality = toGptImageQuality(input.imageSize)

  const body: Record<string, unknown> = {
    prompt: input.prompt,
    n: 1,
    size,
    quality,
    // gpt-image-1 没有 response_format 参数；它默认就返回 b64_json
  }
  if (config.provider !== 'azure_openai') body.model = input.model

  const { url, authHeaders } = buildImageEndpoint(config, input.model, 'generations')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  })
  return parseOpenAIImageResponse(res)
}

// ─────────── gpt-image 图生图（multipart） ───────────
async function generateGptImageEdit(
  config: ProviderConfig,
  input: ImageInput
): Promise<ImageResult> {
  const size = GPT_IMAGE_SIZE_MAP[input.aspectRatio ?? '1:1'] ?? '1024x1024'
  const quality = toGptImageQuality(input.imageSize)

  const form = new FormData()
  form.append('prompt', input.prompt)
  form.append('n', '1')
  form.append('size', size)
  form.append('quality', quality)
  if (config.provider !== 'azure_openai') form.append('model', input.model)

  // OpenAI gpt-image-1 image edit：多图通过重复 'image' 字段传，不是 'image[]'
  // (gpt-image-1 上限 16 张，总大小 50MB)
  const refs = input.refImages ?? []
  refs.forEach((ref, i) => {
    const buf = Buffer.from(ref.data, 'base64')
    const blob = new Blob([buf], { type: ref.mimeType || 'image/png' })
    form.append('image', blob, `ref-${i}.png`)
  })

  const { url, authHeaders } = buildImageEndpoint(config, input.model, 'edits')
  // multipart：不要手动设置 Content-Type，让 fetch 自带 boundary
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  })
  return parseOpenAIImageResponse(res)
}

/** 从 Images API JSON 提取 usage（gpt-image / 部分网关返回 snake_case；少数兼容层用 camelCase 或 chat 风格字段名） */
function parseImagesApiUsage(data: Record<string, unknown>): GeminiUsage {
  const raw = data.usage
  if (!raw || typeof raw !== 'object') {
    return { inputTokens: ZERO, outputTokens: ZERO, totalTokens: ZERO }
  }
  const u = raw as Record<string, unknown>
  const n = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v))
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Math.max(0, parseInt(v.trim(), 10))
    return 0
  }
  const input = BigInt(
    n(u.input_tokens ?? u.prompt_tokens ?? (u as { inputTokens?: unknown }).inputTokens)
  )
  const output = BigInt(
    n(u.output_tokens ?? u.completion_tokens ?? (u as { outputTokens?: unknown }).outputTokens)
  )
  let total = BigInt(n(u.total_tokens ?? (u as { totalTokens?: unknown }).totalTokens))
  if (total === ZERO && (input > ZERO || output > ZERO)) {
    total = input + output
  }
  if (total === ZERO && input === ZERO && output === ZERO) {
    return { inputTokens: ZERO, outputTokens: ZERO, totalTokens: ZERO }
  }
  // 仅有 total 时（个别上游），归入 totalTokens 供报表与审计展示
  if (input === ZERO && output === ZERO && total > ZERO) {
    return { inputTokens: ZERO, outputTokens: ZERO, totalTokens: total }
  }
  if (total === ZERO || total < input + output) {
    total = input + output
  }
  return { inputTokens: input, outputTokens: output, totalTokens: total }
}

// ─────────── 响应解析（OpenAI 系通用） ───────────
async function parseOpenAIImageResponse(res: Response): Promise<ImageResult> {
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ??
      `图片生成失败 HTTP ${res.status}`
    throw new Error(errMsg)
  }

  const items =
    (data as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }).data ??
    []
  if (items.length === 0) throw new Error('OpenAI 图片接口未返回数据')

  const images: Array<{ mimeType: string; base64: string }> = []
  let revisedPrompt = ''

  for (const item of items) {
    if (item.b64_json) {
      images.push({ mimeType: 'image/png', base64: item.b64_json })
    } else if (item.url) {
      // Azure DALL-E 在某些区域只返回临时 URL（约 1 小时过期），立即下载转 base64
      const r = await fetch(item.url)
      if (!r.ok) throw new Error(`下载临时图片 URL 失败 HTTP ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      images.push({ mimeType: 'image/png', base64: buf.toString('base64') })
    }
    if (item.revised_prompt) revisedPrompt = item.revised_prompt
  }

  if (images.length === 0) throw new Error('OpenAI 图片接口返回缺少 b64_json/url')

  return {
    images,
    revisedPrompt,
    usage: parseImagesApiUsage(data),
    raw: data,
  }
}
