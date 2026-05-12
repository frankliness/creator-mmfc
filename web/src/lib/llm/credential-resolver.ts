/**
 * Credential resolver — v1.3.0
 *
 * 与 config-resolver.ts 的区别：
 * - config-resolver.ts：按 purpose 取 GlobalConfig 单一 ProviderConfig（v1.2.0）
 * - credential-resolver.ts：按 (purpose, modelKey) 在 ModelRegistry + ProviderCredential
 *   池中匹配凭据，支持同 purpose 下多 provider 共存（v1.3.0）
 *
 * 解析优先级：
 *   1. UserApiConfig（用户级 override；存在 credentialId 则解为共享凭据，否则用其内嵌字段）
 *   2. 显式传入的 preferredCredentialId（必须满足模型 providers 限制）
 *   3. ModelRegistry.providers 顺序 → 找 purpose/modelKey 范围内 isPrimary=true 的 ProviderCredential
 *   4. 同 providers + purpose/modelKey 范围内任意 isActive ProviderCredential
 *   5. 兜底回退到老的 config-resolver（GlobalConfig.${purpose}_*）
 */

import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { getGlobalConfig } from '@/lib/global-config'
import { resolveProviderConfig as legacyResolve, normalizeBase } from './config-resolver'
import type { ProviderConfig, ProviderType, Purpose } from './types'

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const ALL_PURPOSES: Purpose[] = ['chat', 'storyboard', 'canvas_image', 'canvas_image_edit']

/** 选项：让上层传 preferredCredentialId（来自请求体），并能跳过 legacy fallback */
export interface ResolveOptions {
  userId?: string
  preferredCredentialId?: string
  /** 调试用：禁用兜底到 GlobalConfig 老 key（生产路径不要设） */
  disableLegacyFallback?: boolean
}

async function tryReadUserConfig(
  purpose: Purpose,
  userId: string
): Promise<ProviderConfig | null> {
  const userConfig = await prisma.userApiConfig.findFirst({
    where: { userId, callType: purpose, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!userConfig) return null

  // 如果引用了共享凭据，优先用共享凭据的最新值
  if (userConfig.credentialId) {
    const cred = await prisma.providerCredential.findUnique({
      where: { id: userConfig.credentialId },
    })
    if (cred && cred.isActive) {
      return decryptCredential(cred, userConfig.model || '')
    }
  }

  // 否则用 UserApiConfig 自带的 endpoint/apiKey 快照
  let plainKey: string
  try {
    plainKey = decrypt(userConfig.apiKey)
  } catch (err) {
    console.error(
      `[credential-resolver] decrypt user ${userId} (callType=${purpose}) apiKey failed:`,
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

async function resolveGeminiGlobalConfig(requestedModel: string): Promise<ProviderConfig | null> {
  const apiKey = (await getGlobalConfig('gemini_api_key')) || process.env.GEMINI_API_KEY || ''
  if (!apiKey) return null
  const baseUrl = (await getGlobalConfig('gemini_base_url')) || process.env.GEMINI_BASE_URL || GEMINI_DEFAULT_BASE

  return {
    provider: 'google',
    baseUrl: normalizeBase(baseUrl),
    apiKey,
    model: requestedModel,
  }
}

function decryptCredential(
  cred: {
    provider: string
    baseUrl: string
    apiKey: string
    deployment: string | null
    apiVersion: string | null
  },
  requestedModel: string
): ProviderConfig {
  return {
    provider: cred.provider as ProviderType,
    baseUrl: normalizeBase(cred.baseUrl),
    apiKey: decrypt(cred.apiKey),
    model: requestedModel,
    ...(cred.deployment ? { deployment: cred.deployment } : {}),
    ...(cred.apiVersion ? { apiVersion: cred.apiVersion } : {}),
  }
}

type CredentialScope = {
  purposes?: unknown
  modelKeys?: unknown
  sortOrder: number
  createdAt: Date
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function credentialPurposes(cred: { purposes?: unknown }): string[] {
  const purposes = readStringArray(cred.purposes)
  return purposes && purposes.length > 0 ? purposes : ALL_PURPOSES
}

function credentialModelKeys(cred: { modelKeys?: unknown }): string[] | null {
  const modelKeys = readStringArray(cred.modelKeys)
  return modelKeys && modelKeys.length > 0 ? modelKeys : null
}

/** worker 渠道调度时复用，判断一条凭据是否覆盖 (purpose, modelKey)。 */
export function credentialMatchesScope(
  cred: { purposes?: unknown; modelKeys?: unknown },
  purpose: Purpose,
  modelKey: string
): boolean {
  const purposes = credentialPurposes(cred)
  if (!purposes.includes(purpose)) return false

  const modelKeys = credentialModelKeys(cred)
  return !modelKeys || modelKeys.includes(modelKey)
}

function pickBestScopedCredential<T extends CredentialScope>(
  credentials: T[],
  purpose: Purpose,
  modelKey: string
): T | null {
  const matches = credentials.filter((c) => credentialMatchesScope(c, purpose, modelKey))
  if (matches.length === 0) return null

  return matches.sort((a, b) => {
    const aSpecific = credentialModelKeys(a)?.includes(modelKey) ? 0 : 1
    const bSpecific = credentialModelKeys(b)?.includes(modelKey) ? 0 : 1
    if (aSpecific !== bSpecific) return aSpecific - bSpecific
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.createdAt.getTime() - b.createdAt.getTime()
  })[0]
}

/** 按模型 providers 偏好顺序找凭据（先 scoped primary，再 scoped 任意 active） */
async function pickCredentialForModel(
  purpose: Purpose,
  modelKey: string,
  supportedProviders: string[],
  preferredCredentialId?: string
) {
  if (preferredCredentialId) {
    const c = await prisma.providerCredential.findUnique({
      where: { id: preferredCredentialId },
    })
    if (!c || !c.isActive) {
      throw new Error(
        `指定的凭据 ${preferredCredentialId} 不存在或已禁用`
      )
    }
    if (!supportedProviders.includes(c.provider)) {
      throw new Error(
        `凭据 ${c.name}(${c.provider}) 不在模型支持的 provider 列表 [${supportedProviders.join(',')}]`
      )
    }
    if (!credentialMatchesScope(c, purpose, modelKey)) {
      throw new Error(
        `凭据 ${c.name} 不适用于 ${modelKey}@${purpose}`
      )
    }
    return c
  }

  // 按 model.providers 顺序找当前 purpose/modelKey 范围内的 primary
  for (const p of supportedProviders) {
    const candidates = await prisma.providerCredential.findMany({
      where: { provider: p, isActive: true, isPrimary: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const c = pickBestScopedCredential(candidates, purpose, modelKey)
    if (c) return c
  }

  // 兜底：当前 purpose/modelKey 范围内任意 active，仍保持 model.providers 顺序。
  for (const p of supportedProviders) {
    const candidates = await prisma.providerCredential.findMany({
      where: { provider: p, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const c = pickBestScopedCredential(candidates, purpose, modelKey)
    if (c) return c
  }

  return null
}

/**
 * 主入口：按 (purpose, modelKey) 解析凭据。
 *
 * @param purpose 调用用途，与 ModelRegistry.category 对齐
 * @param requestedModelKey 前端选定的 modelKey（必填）
 */
export async function resolveByModel(
  purpose: Purpose,
  requestedModelKey: string,
  opts: ResolveOptions = {}
): Promise<ProviderConfig> {
  const { userId, preferredCredentialId, disableLegacyFallback } = opts

  // 1. UserApiConfig override
  if (userId) {
    const userOwn = await tryReadUserConfig(purpose, userId)
    if (userOwn) return userOwn
  }

  // 2. ModelRegistry 查模型
  const model = await prisma.modelRegistry.findUnique({
    where: { modelKey_category: { modelKey: requestedModelKey, category: purpose } },
  })

  if (model && model.isActive) {
    const supportedProviders = Array.isArray(model.providers)
      ? (model.providers as string[])
      : []
    if (supportedProviders.length === 0) {
      throw new Error(
        `模型 ${requestedModelKey}@${purpose} 未声明 providers`
      )
    }

    const cred = await pickCredentialForModel(
      purpose,
      requestedModelKey,
      supportedProviders,
      preferredCredentialId
    )
    if (cred) {
      return decryptCredential(cred, requestedModelKey)
    }

    if (supportedProviders.includes('google')) {
      const googleConfig = await resolveGeminiGlobalConfig(requestedModelKey)
      if (googleConfig) return googleConfig
    }

    // 模型注册了但找不到匹配 provider 的凭据，不能静默走其他 provider 的 legacy 配置。
    throw new Error(
      `没有可用凭据：模型 ${requestedModelKey}@${purpose} 需要 provider [${supportedProviders.join(',')}]`
    )
  } else if (model && !model.isActive) {
    throw new Error(`模型 ${requestedModelKey}@${purpose} 已被禁用`)
  }
  // 模型没注册：不阻塞，走 legacy（兼容旧画布配置 / Storyboard 早期默认）

  // 3. 兜底：老的 GlobalConfig.${purpose}_* 凭据组（v1.2.0）
  if (disableLegacyFallback) {
    throw new Error(
      `没有可用凭据：模型 ${requestedModelKey}@${purpose}`
    )
  }
  return legacyResolve(purpose, userId)
}

// 用途便捷函数
export const resolveChatByModel = (modelKey: string, opts?: ResolveOptions) =>
  resolveByModel('chat', modelKey, opts)
export const resolveImageByModel = (modelKey: string, opts?: ResolveOptions) =>
  resolveByModel('canvas_image', modelKey, opts)
export const resolveImageEditByModel = (modelKey: string, opts?: ResolveOptions) =>
  resolveByModel('canvas_image_edit', modelKey, opts)
export const resolveStoryboardByModel = (modelKey: string, opts?: ResolveOptions) =>
  resolveByModel('storyboard', modelKey, opts)
