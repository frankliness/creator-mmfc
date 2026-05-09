export type ProviderType = 'openai' | 'azure_openai' | 'google' | 'custom'

export type Purpose = 'chat' | 'storyboard' | 'canvas_image' | 'canvas_image_edit'

export interface ProviderConfig {
  provider: ProviderType
  baseUrl: string
  apiKey: string
  /** 用户/前端选择的模型名（OpenAI body.model 用） */
  model: string
  /** Azure 专用：部署名，构造 URL 时优先使用，缺省 fallback 到 model */
  deployment?: string
  /** Azure 专用：api-version */
  apiVersion?: string
}

export interface ChatEndpoint {
  url: string
  headers: Record<string, string>
}

export interface ModelCapabilities {
  maxContextTokens: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsTools: boolean
  /** OpenAI structured output: response_format.json_schema */
  supportsJsonSchema: boolean
  /** 老式 response_format: { type: 'json_object' } */
  supportsJsonMode: boolean
  supportsStreaming: boolean
  supportsImageGen: boolean
  /** 图生图（参考图编辑） */
  supportsImageEdit: boolean
  /** 图片尺寸/质量参数风格，决定前端 UI 和后端转换 */
  imageSizeStyle?: 'dalle3' | 'gpt-image' | 'gemini' | 'none'
  pricing?: {
    inputPer1M?: number
    outputPer1M?: number
    cachedInputPer1M?: number
    /** 图片单价：key 形如 "1024x1024_hd" 或 "high" */
    perImage?: Record<string, number>
  }
}
