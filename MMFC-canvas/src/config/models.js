/**
 * Models Configuration | 模型配置
 * Centralized model configuration | 集中模型配置
 */

export const BANANA_SIZE_OPTIONS = [
  { label: '21:9', key: '21:9' },
  { label: '16:9', key: '16:9' },
  { label: '4:3', key: '4:3' },
  { label: '3:2', key: '3:2' },
  { label: '1:1', key: '1:1' },
  { label: '2:3', key: '2:3' },
  { label: '3:4', key: '3:4' },
  { label: '9:16', key: '9:16' }
]

export const GOOGLE_IMAGE_SIZE_OPTIONS = [
  { label: '1K', key: '1K' },
  { label: '2K', key: '2K' },
  { label: '4K', key: '4K' }
]

// Backward-compatible exports used by the UI/store helpers
export const SEEDREAM_SIZE_OPTIONS = BANANA_SIZE_OPTIONS
export const SEEDREAM_4K_SIZE_OPTIONS = BANANA_SIZE_OPTIONS
export const SEEDREAM_QUALITY_OPTIONS = GOOGLE_IMAGE_SIZE_OPTIONS
export const SEEDANCE_RESOLUTION_OPTIONS = []

export const IMAGE_MODELS = [
  {
    label: 'Nano Banana 2',
    key: 'gemini-3.1-flash-image-preview',
    provider: ['google'],
    sizes: BANANA_SIZE_OPTIONS.map(option => option.key),
    qualities: GOOGLE_IMAGE_SIZE_OPTIONS,
    qualityLabel: '分辨率',
    tips: 'Google 原生 Gemini Image API，支持多图输入与图像编辑。',
    defaultParams: {
      size: '1:1',
      quality: '2K'
    }
  },
  {
    label: 'Nano Banana Pro',
    key: 'gemini-3-pro-image-preview',
    provider: ['google'],
    sizes: BANANA_SIZE_OPTIONS.map(option => option.key),
    qualities: GOOGLE_IMAGE_SIZE_OPTIONS,
    qualityLabel: '分辨率',
    tips: 'Google 原生 Gemini Image API，支持复杂指令、高清文字与专业素材生成。',
    defaultParams: {
      size: '1:1',
      quality: '2K'
    }
  }
]

export const VIDEO_RATIO_LIST = [
  { label: '16:9 (横版)', key: '16:9' },
  { label: '4:3', key: '4:3' },
  { label: '1:1 (方形)', key: '1:1' },
  { label: '3:4', key: '3:4' },
  { label: '9:16 (竖版)', key: '9:16' }
]

// 本版先聚焦 Google 聊天 + Gemini 原生生图
export const VIDEO_MODELS = []

export const CHAT_MODELS = [
  { label: 'Gemini 3 Flash', key: 'gemini-3-flash-preview', provider: ['google'] },
  { label: 'Gemini 2.5 Flash', key: 'gemini-2.5-flash', provider: ['google'] },
  { label: 'Gemini 3 Pro', key: 'gemini-3-pro-preview', provider: ['google'] },
  { label: 'Gemini 2.5 Pro', key: 'gemini-2.5-pro', provider: ['google'] }
]

export const IMAGE_SIZE_OPTIONS = BANANA_SIZE_OPTIONS
export const IMAGE_QUALITY_OPTIONS = GOOGLE_IMAGE_SIZE_OPTIONS

export const IMAGE_STYLE_OPTIONS = []

export const VIDEO_RATIO_OPTIONS = VIDEO_RATIO_LIST
export const VIDEO_DURATION_OPTIONS = [
  { label: '5 秒', key: 5 },
  { label: '10 秒', key: 10 }
]

export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview'
export const DEFAULT_VIDEO_MODEL = ''
export const DEFAULT_CHAT_MODEL = 'gemini-3-flash-preview'
export const DEFAULT_IMAGE_SIZE = '1:1'
export const DEFAULT_VIDEO_RATIO = '16:9'
export const DEFAULT_VIDEO_DURATION = 5

export const getModelByName = (key) => {
  const allModels = [...IMAGE_MODELS, ...VIDEO_MODELS, ...CHAT_MODELS]
  return allModels.find(model => model.key === key)
}
