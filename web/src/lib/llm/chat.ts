import type { ProviderConfig, ChatEndpoint } from './types'

/**
 * 构造 chat 请求的 URL 和 headers。
 * @param requestModel 前端传来的模型名（用于 OpenAI body.model 与 Azure deployment 兜底）
 */
export function buildChatEndpoint(config: ProviderConfig, requestModel: string): ChatEndpoint {
  const base = config.baseUrl.replace(/\/+$/, '')

  if (config.provider === 'azure_openai') {
    const version = config.apiVersion ?? '2024-08-01-preview'
    // Azure 的 deployment 名独立于 model；admin 没配 deployment 时退回到请求模型名
    const deployment = config.deployment || requestModel
    return {
      url: `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${version}`,
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
    }
  }

  if (config.provider === 'google') {
    // Gemini 的 OpenAI 兼容端点
    const cleanBase = base.replace(/\/openai$/, '')
    return {
      url: `${cleanBase}/openai/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    }
  }

  // openai / custom — 标准 OpenAI 协议
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  }
}
