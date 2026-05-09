import { getGlobalConfig } from '@/lib/global-config'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import type { ProviderConfig, ProviderType, Purpose } from './types'

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * 把 admin/用户填写的 baseUrl 归一化为"基础前缀"。
 * 容忍粘贴 demo 里的完整 endpoint URL，如 https://api.deepai.org/v1/chat/completions：
 *   1. 去尾部 /
 *   2. 剥常见 OpenAI 系 endpoint 后缀
 *   3. 剥末尾 /openai（Gemini OpenAI 兼容端点）
 */
export function normalizeBase(url: string): string {
  let result = (url || '').trim().replace(/\/+$/, '')
  const endpointSuffixes = [
    '/chat/completions',
    '/images/generations',
    '/images/edits',
    '/images/variations',
    '/embeddings',
    '/audio/speech',
    '/audio/transcriptions',
    '/audio/translations',
    '/responses',
    '/completions',
  ]
  for (const suffix of endpointSuffixes) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length)
      break
    }
  }
  result = result.replace(/\/openai$/, '')
  return result
}

const PURPOSE_PREFIX: Record<Purpose, string> = {
  chat: 'chat',
  storyboard: 'storyboard',
  canvas_image: 'canvas_image',
  canvas_image_edit: 'canvas_image_edit',
}

/** 读取某用途的 GlobalConfig 配置；未配置任一关键字段返回 null。 */
async function tryReadGlobalConfig(prefix: string): Promise<ProviderConfig | null> {
  const provider = await getGlobalConfig(`${prefix}_provider`)
  if (!provider) return null

  const [baseUrl, apiKey, model, deployment, apiVersion] = await Promise.all([
    getGlobalConfig(`${prefix}_base_url`),
    getGlobalConfig(`${prefix}_api_key`),
    getGlobalConfig(`${prefix}_model`),
    getGlobalConfig(`${prefix}_deployment`),
    getGlobalConfig(`${prefix}_api_version`),
  ])

  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      `${prefix}_provider 已设置但缺少 ${prefix}_base_url / ${prefix}_api_key / ${prefix}_model`
    )
  }

  return {
    provider: provider as ProviderType,
    baseUrl: normalizeBase(baseUrl),
    apiKey,
    model,
    ...(deployment ? { deployment } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  }
}

/** 读取某用户在某用途下的 default UserApiConfig；不存在/解密失败返回 null。 */
async function tryReadUserConfig(
  purpose: Purpose,
  userId: string
): Promise<ProviderConfig | null> {
  const userConfig = await prisma.userApiConfig.findFirst({
    where: { userId, callType: purpose, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!userConfig) return null

  let plainKey: string
  try {
    plainKey = decrypt(userConfig.apiKey)
  } catch (err) {
    console.error(
      `[config-resolver] decrypt user ${userId} (callType=${purpose}) apiKey failed:`,
      err
    )
    return null
  }

  return {
    provider: userConfig.provider as ProviderType,
    baseUrl: normalizeBase(userConfig.endpoint),
    apiKey: plainKey,
    model: userConfig.model || '',
    ...(userConfig.deployment ? { deployment: userConfig.deployment } : {}),
    ...(userConfig.apiVersion ? { apiVersion: userConfig.apiVersion } : {}),
  }
}

/** 向后兼容：fallback 到 gemini_* keys。 */
async function geminiFallback(defaultModel: string): Promise<ProviderConfig> {
  const apiKey = (await getGlobalConfig('gemini_api_key')) ?? process.env.GEMINI_API_KEY ?? ''
  if (!apiKey) {
    throw new Error('未配置 Provider（GlobalConfig 或 env GEMINI_API_KEY）')
  }
  const rawBase =
    (await getGlobalConfig('gemini_base_url')) ?? process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE
  const model = (await getGlobalConfig('gemini_model')) ?? process.env.GEMINI_MODEL ?? defaultModel
  return { provider: 'google', baseUrl: normalizeBase(rawBase), apiKey, model }
}

/**
 * 按用途解析 Provider 配置。
 *
 * 优先级（决策 5=B：用户级 override 全用途生效）：
 *   1. 用户专属 UserApiConfig（callType=purpose, isDefault, isActive）
 *   2. 用户的 canvas_image 配置（仅 image_edit 时回退）
 *   3. 用途专属 GlobalConfig（${prefix}_*）
 *   4. 全局 canvas_image 配置（仅 image_edit 时回退）
 *   5. gemini_* 老 key 兜底
 */
export async function resolveProviderConfig(
  purpose: Purpose,
  userId?: string
): Promise<ProviderConfig> {
  // 1 + 2: 用户级
  if (userId) {
    const userOwn = await tryReadUserConfig(purpose, userId)
    if (userOwn) return userOwn
    if (purpose === 'canvas_image_edit') {
      const userImage = await tryReadUserConfig('canvas_image', userId)
      if (userImage) return userImage
    }
  }

  // 3 + 4: 全局级
  const globalOwn = await tryReadGlobalConfig(PURPOSE_PREFIX[purpose])
  if (globalOwn) return globalOwn
  if (purpose === 'canvas_image_edit') {
    const globalImage = await tryReadGlobalConfig('canvas_image')
    if (globalImage) return globalImage
  }

  // 5: gemini_* fallback
  const defaults: Record<Purpose, string> = {
    chat: 'gemini-3-flash-preview',
    storyboard: 'gemini-3.1-pro-preview',
    canvas_image: 'gemini-3-pro-image-preview',
    canvas_image_edit: 'gemini-3-pro-image-preview',
  }
  return geminiFallback(defaults[purpose])
}

// 用途便捷函数（带 userId 可选参数；未传则跳过用户级 override）
export const resolveChatConfig = (userId?: string) => resolveProviderConfig('chat', userId)
export const resolveImageConfig = (userId?: string) => resolveProviderConfig('canvas_image', userId)
export const resolveImageEditConfig = (userId?: string) =>
  resolveProviderConfig('canvas_image_edit', userId)
export const resolveStoryboardConfig = (userId?: string) =>
  resolveProviderConfig('storyboard', userId)
