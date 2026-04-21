/**
 * API Provider Adapters | API 渠道适配器
 * Google 官方 Gemini 接入：聊天走 OpenAI 兼容，图片走原生 Gemini Image API
 */

export const GOOGLE_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
export const GOOGLE_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const getGoogleNativeBaseUrl = (baseUrl = GOOGLE_OPENAI_BASE_URL) => {
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.endsWith('/openai')
    ? normalized.slice(0, -'/openai'.length)
    : normalized
}

const mapGeminiInlineData = (part = {}) => {
  const inlineData = part.inline_data || part.inlineData
  if (!inlineData?.data) return null

  const mimeType = inlineData.mime_type || inlineData.mimeType || 'image/png'
  return {
    url: `data:${mimeType};base64,${inlineData.data}`,
    mimeType
  }
}

export const PROVIDERS = {
  google: {
    label: 'Google Gemini (Official)',
    defaultBaseUrl: GOOGLE_OPENAI_BASE_URL,
    endpoints: {
      chat: '/chat/completions',
      image: '/models/{model}:generateContent',
      video: null,
      videoQuery: null
    },
    requestAdapter: {
      chat: (params) => {
        const adapted = {
          model: params.model,
          messages: params.messages
        }

        if (params.temperature !== undefined) adapted.temperature = params.temperature
        if (params.max_tokens !== undefined) adapted.max_tokens = params.max_tokens
        if (params.reasoning_effort !== undefined) adapted.reasoning_effort = params.reasoning_effort
        if (params.stream !== undefined) adapted.stream = params.stream

        return adapted
      }
    },
    responseAdapter: {
      chat: (response) => {
        if (response.choices?.length) {
          return response.choices[0].message?.content || ''
        }

        if (response.candidates?.length) {
          return response.candidates[0].content?.parts
            ?.map(part => part.text || '')
            .join('')
            .trim() || ''
        }

        return response.text || ''
      },
      image: (response) => {
        const parts = response.candidates?.flatMap(candidate => candidate.content?.parts || []) || []
        const images = parts
          .map(mapGeminiInlineData)
          .filter(Boolean)

        if (images.length > 0) {
          const revisedPrompt = parts
            .map(part => part.text || '')
            .filter(Boolean)
            .join('\n')
            .trim()

          return images.map(image => ({
            url: image.url,
            mimeType: image.mimeType,
            revisedPrompt
          }))
        }

        const fallbackData = response.data || response
        return (Array.isArray(fallbackData) ? fallbackData : [fallbackData]).map(item => ({
          url: item.url || item.b64_json || '',
          revisedPrompt: item.revised_prompt || ''
        }))
      },
      video: (response) => response
    }
  },
  default: 'google'
}

export const getProviderList = () => {
  return Object.entries(PROVIDERS)
    .filter(([key]) => key !== 'default')
    .map(([key, value]) => ({
      key,
      label: value.label
    }))
}

export const getDefaultProvider = () => {
  return PROVIDERS.default || 'google'
}

export const getDefaultBaseUrl = (providerKey) => {
  const config = getProviderConfig(providerKey)
  return config.defaultBaseUrl || ''
}

export const getProviderConfig = (providerKey) => {
  return PROVIDERS[providerKey] || PROVIDERS[PROVIDERS.default]
}
