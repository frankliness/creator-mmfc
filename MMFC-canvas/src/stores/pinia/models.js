/**
 * Pinia Store: Model Config | 模型配置 Store
 * 管理模型配置、渠道切换和模型选择
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  CHAT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL
} from '@/config/models'
import { PROVIDERS, getProviderList, getDefaultProvider, getProviderConfig, getDefaultBaseUrl } from '@/config/providers'
import { fetchCanvasConfig } from '@/api/config'

// 存储键名
const STORAGE_KEYS = {
  PROVIDER: 'api-provider',
  CUSTOM_CHAT_MODELS: 'custom-chat-models',
  CUSTOM_IMAGE_MODELS: 'custom-image-models',
  CUSTOM_VIDEO_MODELS: 'custom-video-models',
  SELECTED_CHAT_MODEL: 'selected-chat-model',
  SELECTED_IMAGE_MODEL: 'selected-image-model',
  SELECTED_VIDEO_MODEL: 'selected-video-model',
  CUSTOM_CHAT_MODELS_BY_PROVIDER: 'custom-chat-models-by-provider',
  CUSTOM_IMAGE_MODELS_BY_PROVIDER: 'custom-image-models-by-provider',
  CUSTOM_VIDEO_MODELS_BY_PROVIDER: 'custom-video-models-by-provider',
  API_KEYS_BY_PROVIDER: 'api-keys-by-provider',
  BASE_URLS_BY_PROVIDER: 'base-urls-by-provider'
}

/**
 * Get stored value from localStorage
 */
const getStored = (key, defaultValue = '') => {
  try {
    return localStorage.getItem(key) || defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Set stored value to localStorage
 */
const setStored = (key, value) => {
  try {
    if (value) {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

const removeStored = (key) => {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/**
 * Get stored JSON value from localStorage
 */
const getStoredJson = (key, defaultValue = []) => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Set stored JSON value to localStorage
 */
const setStoredJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

/**
 * 检查模型是否支持指定渠道
 */
const isModelSupported = (model, provider) => {
  if (!model.provider) {
    return true
  }
  return model.provider.includes(provider)
}

export const useModelStore = defineStore('model', () => {
  // ============ Provider 状态 | Provider State ============

  // 当前选中的渠道
  const storedProvider = getStored(STORAGE_KEYS.PROVIDER)
  const currentProvider = ref(PROVIDERS[storedProvider] ? storedProvider : getDefaultProvider())

  // 渠道列表
  const providerList = computed(() => getProviderList())

  // 当前渠道配置
  const providerConfig = computed(() => getProviderConfig(currentProvider.value))

  // 当前渠道标签
  const providerLabel = computed(() => providerConfig.value.label || currentProvider.value)

  // 设置当前渠道
  const setProvider = (provider) => {
    if (PROVIDERS[provider]) {
      currentProvider.value = provider
      setStored(STORAGE_KEYS.PROVIDER, provider)
    }
  }

  // 清除渠道配置
  const clearProvider = () => {
    currentProvider.value = getDefaultProvider()
    removeStored(STORAGE_KEYS.PROVIDER)
  }

  // 适配请求参数
  const adaptRequest = (type, params) => {
    const config = providerConfig.value
    if (config.requestAdapter && config.requestAdapter[type]) {
      return config.requestAdapter[type](params)
    }
    return params
  }

  // 适配响应数据
  const adaptResponse = (type, response) => {
    const config = providerConfig.value
    if (config.responseAdapter && config.responseAdapter[type]) {
      return config.responseAdapter[type](response)
    }
    return response
  }

  // ============ Custom Models 状态 | Custom Models State ============

  // 全局自定义模型（不区分渠道）
  const customChatModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS, []))
  const customImageModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS, []))
  const customVideoModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS, []))

  // 按渠道存储的自定义模型 | 结构: { 'google': [{key, label}] }
  const customChatModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS_BY_PROVIDER, {}))
  const customImageModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS_BY_PROVIDER, {}))
  const customVideoModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS_BY_PROVIDER, {}))

  // 选中的模型
  const selectedChatModel = ref(getStored(STORAGE_KEYS.SELECTED_CHAT_MODEL, DEFAULT_CHAT_MODEL))
  const selectedImageModel = ref(getStored(STORAGE_KEYS.SELECTED_IMAGE_MODEL, DEFAULT_IMAGE_MODEL))
  const selectedVideoModel = ref(getStored(STORAGE_KEYS.SELECTED_VIDEO_MODEL, DEFAULT_VIDEO_MODEL))

  // 按渠道存储的 API 配置
  const apiKeysByProvider = ref(getStoredJson(STORAGE_KEYS.API_KEYS_BY_PROVIDER, {}))
  const baseUrlsByProvider = ref(getStoredJson(STORAGE_KEYS.BASE_URLS_BY_PROVIDER, {}))

  // ============ Server Config 同步 ============
  // Provider/默认模型/能力快照/ModelRegistry 来自后端 /api/canvas/config。
  // 启动时调用 initFromServer 拉一次：
  //   1. 把 currentProvider 切到后端实际生效的 provider
  //   2. 用 ModelRegistry 替换硬编码 IMAGE_MODELS / CHAT_MODELS（server 列表为准；admin 启用一个就多一个）
  const serverConfig = ref({
    chat: { provider: null, defaultModel: null },
    image: { provider: null, defaultModel: null },
    imageEdit: { provider: null, defaultModel: null },
    storyboard: { provider: null, defaultModel: null },
  })
  const serverCapabilities = ref({})
  // 来自 ModelRegistry，已转换成 models.js 的形态（field 名 provider 而非 providers）
  const serverChatModels = ref([])
  const serverImageModels = ref([])
  const serverImageEditModels = ref([])
  const serverStoryboardModels = ref([])
  // v1.3.0：admin 维护的共享凭据池（无 apiKey；供前端齿轮选凭据用）
  const serverCredentials = ref([])
  // v1.3.0：每用途的默认 modelKey
  const serverDefaults = ref({
    chat: { modelKey: null },
    canvas_image: { modelKey: null },
    canvas_image_edit: { modelKey: null },
    storyboard: { modelKey: null },
  })
  const serverInitialized = ref(false)

  const transformRegistryEntry = (m) => {
    if (!m) return null
    const cap = m.capabilities || {}
    return {
      key: m.key,
      label: m.label,
      provider: Array.isArray(m.providers) ? m.providers : [],
      sizes: Array.isArray(m.sizes) ? m.sizes : undefined,
      qualities: Array.isArray(m.qualities) ? m.qualities : undefined,
      qualityLabel: cap.imageGen || cap.imageEdit ? '质量' : undefined,
      defaultParams: m.defaultParams || undefined,
      tips: m.tips || undefined,
      capabilities: { imageGen: !!cap.imageGen, imageEdit: !!cap.imageEdit, ...cap },
    }
  }

  const initFromServer = async () => {
    try {
      const cfg = await fetchCanvasConfig()
      if (!cfg) return false

      serverConfig.value = {
        chat: cfg.chat || { provider: null, defaultModel: null },
        image: cfg.image || { provider: null, defaultModel: null },
        imageEdit: cfg.imageEdit || { provider: null, defaultModel: null },
        storyboard: cfg.storyboard || { provider: null, defaultModel: null },
      }
      serverCapabilities.value = cfg.capabilities || {}

      // ModelRegistry → 各 category 的可用模型
      const reg = cfg.models || {}
      serverChatModels.value = (reg.chat || []).map(transformRegistryEntry).filter(Boolean)
      serverImageModels.value = (reg.canvas_image || []).map(transformRegistryEntry).filter(Boolean)
      serverImageEditModels.value = (reg.canvas_image_edit || []).map(transformRegistryEntry).filter(Boolean)
      serverStoryboardModels.value = (reg.storyboard || []).map(transformRegistryEntry).filter(Boolean)

      // v1.3.0：凭据池 + 用途默认模型
      serverCredentials.value = Array.isArray(cfg.credentials) ? cfg.credentials : []
      if (cfg.defaults && typeof cfg.defaults === 'object') {
        serverDefaults.value = {
          chat: cfg.defaults.chat || { modelKey: null },
          canvas_image: cfg.defaults.canvas_image || { modelKey: null },
          canvas_image_edit: cfg.defaults.canvas_image_edit || { modelKey: null },
          storyboard: cfg.defaults.storyboard || { modelKey: null },
        }
      }

      // currentProvider 在 v1.3.0 中已不再决定调用路径（凭据由模型 providers 自动匹配）
      // 但仍保留作为前端"主推 provider 风格"的偏好（影响 dropdown 默认排序等）。
      const targetProvider =
        cfg.image?.provider || cfg.chat?.provider || getDefaultProvider()
      if (PROVIDERS[targetProvider] && targetProvider !== currentProvider.value) {
        currentProvider.value = targetProvider
        setStored(STORAGE_KEYS.PROVIDER, targetProvider)
      }

      // 默认模型：v1.3.0 优先用 defaults.${purpose}.modelKey；fallback 到 chat/image.defaultModel
      const defaultImage = serverDefaults.value.canvas_image?.modelKey || cfg.image?.defaultModel
      const defaultChat = serverDefaults.value.chat?.modelKey || cfg.chat?.defaultModel
      if (defaultImage && !serverImageModels.value.some(m => m.key === selectedImageModel.value)) {
        selectedImageModel.value = defaultImage
      }
      if (defaultChat && !serverChatModels.value.some(m => m.key === selectedChatModel.value)) {
        selectedChatModel.value = defaultChat
      }

      serverInitialized.value = true
      return true
    } catch (err) {
      console.warn('[modelStore] initFromServer failed:', err)
      return false
    }
  }

  /** 查询某个模型的能力（来自 server capabilities 快照） */
  const getServerCapabilities = (modelKey) => serverCapabilities.value[modelKey] || null

  /** 是否支持图生图（图生图节点用此过滤模型选项） */
  const supportsImageEdit = (modelKey) => {
    const cap = serverCapabilities.value[modelKey]
    if (cap) return !!cap.supportsImageEdit
    // server 还没初始化时回退到本地 IMAGE_MODELS 的 capabilities 字段
    const local = IMAGE_MODELS.find(m => m.key === modelKey)
    return !!local?.capabilities?.imageEdit
  }

  // 集成版：API Key 由 Creator MMFC 主站后端通过 NextAuth 会话注入，
  // 前端永远视为"已就绪"。currentApiKey 仅用于旧 UI 的 isConfigured 判断，
  // 不会被任何请求实际使用（Authorization 已不再注入）。
  const currentApiKey = computed(() => '__SERVER_PROXY__')
  // BaseURL 留一个占位，所有调用走 axios 实例的 baseURL='/api/canvas'
  const currentBaseUrl = computed(() => baseUrlsByProvider.value[currentProvider.value] || getDefaultBaseUrl(currentProvider.value))

  // 设置指定渠道的 API Key
  const setApiKeyByProvider = (provider, apiKey) => {
    apiKeysByProvider.value[provider] = apiKey
  }

  // 设置指定渠道的 Base URL
  const setBaseUrlByProvider = (provider, baseUrl) => {
    baseUrlsByProvider.value[provider] = baseUrl
  }

  // 清除指定渠道的 API 配置
  const clearApiConfigByProvider = (provider) => {
    delete apiKeysByProvider.value[provider]
    delete baseUrlsByProvider.value[provider]
  }

  // ============ Computed: All Models (built-in + custom + by provider) ============

  // server 注册的模型清单优先；server 还没初始化时用代码内置 CHAT_MODELS / IMAGE_MODELS 兜底
  const baseChatModels = computed(() =>
    serverChatModels.value.length > 0 ? serverChatModels.value : CHAT_MODELS
  )
  const baseImageModels = computed(() =>
    serverImageModels.value.length > 0 ? serverImageModels.value : IMAGE_MODELS
  )

  const allChatModels = computed(() => [
    ...baseChatModels.value.map(m => ({ ...m, isCustom: false })),
    ...customChatModels.value.map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true
    })),
    ...(customChatModelsByProvider.value[currentProvider.value] || []).map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      provider: [currentProvider.value]
    }))
  ])

  const allImageModels = computed(() => [
    ...baseImageModels.value.map(m => ({ ...m, isCustom: false })),
    ...customImageModels.value.map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      sizes: [],
      defaultParams: { quality: 'standard', style: 'vivid' }
    })),
    ...(customImageModelsByProvider.value[currentProvider.value] || []).map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      sizes: [],
      defaultParams: { quality: 'standard', style: 'vivid' },
      provider: [currentProvider.value]
    }))
  ])

  const allVideoModels = computed(() => [
    ...VIDEO_MODELS.map(m => ({ ...m, isCustom: false })),
    ...customVideoModels.value.map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      ratios: ['16x9', '9:16', '1:1'],
      durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
      defaultParams: { ratio: '16:9', duration: 5 }
    })),
    // 添加当前渠道的自定义模型
    ...(customVideoModelsByProvider.value[currentProvider.value] || []).map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      ratios: ['16x9', '9:16', '1:1'],
      durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
      defaultParams: { ratio: '16:9', duration: 5 },
      provider: [currentProvider.value]
    }))
  ])

  // ============ Computed: Available Models ============
  //
  // v1.3.0：服务端已初始化（ModelRegistry 接管）时，**不再按 currentProvider 过滤**。
  // 凭据由后端按 model.providers 自动匹配，前端只展示所有 isActive 模型即可。
  // 服务端未初始化时（Canvas 独立部署 / fetch 失败），保留旧的 provider 过滤兜底。

  const availableChatModels = computed(() => {
    if (serverInitialized.value) return allChatModels.value
    return allChatModels.value.filter(m => isModelSupported(m, currentProvider.value))
  })

  const availableImageModels = computed(() => {
    if (serverInitialized.value) return allImageModels.value
    return allImageModels.value.filter(m => isModelSupported(m, currentProvider.value))
  })

  /** 仅图生图场景可用的模型 */
  const availableImageEditModels = computed(() => {
    // 优先使用 server 注册的 image_edit 类目（admin 注册并启用的图生图专用模型）
    if (serverImageEditModels.value.length > 0) {
      return serverInitialized.value
        ? serverImageEditModels.value
        : serverImageEditModels.value.filter(m => isModelSupported(m, currentProvider.value))
    }
    // 退回：在 availableImageModels 上按 capabilities.imageEdit 过滤
    return availableImageModels.value.filter(m => {
      const serverCap = serverCapabilities.value[m.key]
      if (serverCap) return !!serverCap.supportsImageEdit
      if (m.capabilities) return !!m.capabilities.imageEdit
      return true
    })
  })

  const availableVideoModels = computed(() =>
    allVideoModels.value.filter(m => isModelSupported(m, currentProvider.value))
  )

  /** v1.3.0：给定 modelKey，返回可与之匹配的 ProviderCredential 列表（供"齿轮选凭据"UI 用） */
  const getCredentialsForModel = (modelKey) => {
    const model =
      serverChatModels.value.find(m => m.key === modelKey) ||
      serverImageModels.value.find(m => m.key === modelKey) ||
      serverImageEditModels.value.find(m => m.key === modelKey) ||
      serverStoryboardModels.value.find(m => m.key === modelKey)
    if (!model) return []
    const supportedProviders = Array.isArray(model.provider) ? model.provider : []
    return serverCredentials.value.filter(c => supportedProviders.includes(c.provider))
  }

  // ============ Computed: Model Options for UI (all models, not filtered by provider) ============

  // 返回适合 n-dropdown 使用的选项格式（全部模型，不按渠道过滤）
  const allImageModelOptions = computed(() =>
    allImageModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const allVideoModelOptions = computed(() =>
    allVideoModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const allChatModelOptions = computed(() =>
    allChatModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  // ============ Computed: Model Options for UI (filtered by provider - deprecated, use all* instead) ============

  // 返回适合 n-dropdown 使用的选项格式
  const imageModelOptions = computed(() =>
    availableImageModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const videoModelOptions = computed(() =>
    availableVideoModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const chatModelOptions = computed(() =>
    availableChatModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  // ============ Methods: Add/Remove Custom Models ============

  const addCustomChatModel = (modelKey, label = '') => {
    if (!modelKey || customChatModels.value.some(m => m.key === modelKey)) return false
    customChatModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomImageModel = (modelKey, label = '') => {
    if (!modelKey || customImageModels.value.some(m => m.key === modelKey)) return false
    customImageModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomVideoModel = (modelKey, label = '') => {
    if (!modelKey || customVideoModels.value.some(m => m.key === modelKey)) return false
    customVideoModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const removeCustomChatModel = (modelKey) => {
    const idx = customChatModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customChatModels.value.splice(idx, 1)
      if (selectedChatModel.value === modelKey) {
        selectedChatModel.value = DEFAULT_CHAT_MODEL
      }
      return true
    }
    return false
  }

  const removeCustomImageModel = (modelKey) => {
    const idx = customImageModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customImageModels.value.splice(idx, 1)
      if (selectedImageModel.value === modelKey) {
        selectedImageModel.value = DEFAULT_IMAGE_MODEL
      }
      return true
    }
    return false
  }

  const removeCustomVideoModel = (modelKey) => {
    const idx = customVideoModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customVideoModels.value.splice(idx, 1)
      if (selectedVideoModel.value === modelKey) {
        selectedVideoModel.value = DEFAULT_VIDEO_MODEL
      }
      return true
    }
    return false
  }

  // ============ Methods: Get Model Config ============

  const getChatModel = (key) => allChatModels.value.find(m => m.key === key)
  const getImageModel = (key) => allImageModels.value.find(m => m.key === key)
  const getVideoModel = (key) => allVideoModels.value.find(m => m.key === key)

  // ============ Methods: Get API Endpoints ============

  // 集成版：所有端点改成相对 axios baseURL='/api/canvas' 的路径，
  // 视频在初版统一关闭（后端尚未实现）。
  const getImageEndpoint = () => '/images'

  // 视频生成 / 任务查询：后端暂未实现，返回 null 让现有 UI 自然降级提示"未支持"
  const getVideoEndpoint = () => null
  const getVideoTaskEndpoint = () => null

  const getChatEndpoint = () => '/chat'

  // ============ Methods: Get Models By Provider (for ApiSettings) ============

  const getModelsByProvider = (provider) => {
    const chat = [
      ...CHAT_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customChatModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        provider: [provider]
      }))
    ]
    const image = [
      ...IMAGE_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customImageModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        sizes: [],
        defaultParams: { quality: 'standard', style: 'vivid' },
        provider: [provider]
      }))
    ]
    const video = [
      ...VIDEO_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customVideoModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        ratios: ['16x9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5 },
        provider: [provider]
      }))
    ]
    return { chat, image, video }
  }

  // ============ Methods: Add/Remove Custom Models By Provider ============

  const addCustomChatModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customChatModelsByProvider.value[provider]) {
      customChatModelsByProvider.value[provider] = []
    }
    if (customChatModelsByProvider.value[provider].some(m => m.key === modelKey)) return false
    customChatModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomImageModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customImageModelsByProvider.value[provider]) {
      customImageModelsByProvider.value[provider] = []
    }
    if (customImageModelsByProvider.value[provider].some(m => m.key === modelKey)) return false
    customImageModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomVideoModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customVideoModelsByProvider.value[provider]) {
      customVideoModelsByProvider.value[provider] = []
    }
    if (customVideoModelsByProvider.value[provider].some(m => m.key === modelKey)) return false
    customVideoModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const removeCustomChatModelByProvider = (modelKey, provider) => {
    if (!customChatModelsByProvider.value[provider]) return false
    const idx = customChatModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customChatModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  const removeCustomImageModelByProvider = (modelKey, provider) => {
    if (!customImageModelsByProvider.value[provider]) return false
    const idx = customImageModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customImageModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  const removeCustomVideoModelByProvider = (modelKey, provider) => {
    if (!customVideoModelsByProvider.value[provider]) return false
    const idx = customVideoModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customVideoModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  // 清除所有自定义模型
  const clearCustomModels = () => {
    customChatModels.value = []
    customImageModels.value = []
    customVideoModels.value = []
    selectedChatModel.value = DEFAULT_CHAT_MODEL
    selectedImageModel.value = DEFAULT_IMAGE_MODEL
    selectedVideoModel.value = DEFAULT_VIDEO_MODEL
  }

  // ============ Watch & Persist ============

  // 监听并持久化自定义模型
  watch(customChatModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS, val), { deep: true })
  watch(customImageModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS, val), { deep: true })
  watch(customVideoModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS, val), { deep: true })

  // 监听并持久化按渠道的自定义模型
  watch(customChatModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS_BY_PROVIDER, val), { deep: true })
  watch(customImageModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS_BY_PROVIDER, val), { deep: true })
  watch(customVideoModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS_BY_PROVIDER, val), { deep: true })

  // 监听并持久化选中的模型
  watch(selectedChatModel, (val) => setStored(STORAGE_KEYS.SELECTED_CHAT_MODEL, val))
  watch(selectedImageModel, (val) => setStored(STORAGE_KEYS.SELECTED_IMAGE_MODEL, val))
  watch(selectedVideoModel, (val) => setStored(STORAGE_KEYS.SELECTED_VIDEO_MODEL, val))

  // 监听并持久化 API 配置
  watch(apiKeysByProvider, (val) => setStoredJson(STORAGE_KEYS.API_KEYS_BY_PROVIDER, val), { deep: true })
  watch(baseUrlsByProvider, (val) => setStoredJson(STORAGE_KEYS.BASE_URLS_BY_PROVIDER, val), { deep: true })

  return {
    // Provider
    currentProvider,
    providerList,
    providerConfig,
    providerLabel,
    setProvider,
    clearProvider,
    adaptRequest,
    adaptResponse,

    // All models (built-in + custom)
    allChatModels,
    allImageModels,
    allVideoModels,

    // Available models filtered by provider
    availableChatModels,
    availableImageModels,
    availableImageEditModels,
    availableVideoModels,

    // Server-driven config & capabilities
    serverConfig,
    serverCapabilities,
    serverChatModels,
    serverImageModels,
    serverImageEditModels,
    serverStoryboardModels,
    serverCredentials,
    serverDefaults,
    serverInitialized,
    initFromServer,
    getServerCapabilities,
    getCredentialsForModel,
    supportsImageEdit,

    // Model options for UI (dropdown format)
    imageModelOptions,
    videoModelOptions,
    chatModelOptions,

    // All model options (not filtered by provider)
    allImageModelOptions,
    allVideoModelOptions,
    allChatModelOptions,

    // Selected models
    selectedChatModel,
    selectedImageModel,
    selectedVideoModel,

    // Custom models
    customChatModels,
    customImageModels,
    customVideoModels,

    // Custom models by provider
    customChatModelsByProvider,
    customImageModelsByProvider,
    customVideoModelsByProvider,

    // Add/Remove methods
    addCustomChatModel,
    addCustomImageModel,
    addCustomVideoModel,
    removeCustomChatModel,
    removeCustomImageModel,
    removeCustomVideoModel,

    // Add/Remove by provider methods
    addCustomChatModelByProvider,
    addCustomImageModelByProvider,
    addCustomVideoModelByProvider,
    removeCustomChatModelByProvider,
    removeCustomImageModelByProvider,
    removeCustomVideoModelByProvider,

    // Get model
    getChatModel,
    getImageModel,
    getVideoModel,

    // Get API endpoints
    getImageEndpoint,
    getVideoEndpoint,
    getVideoTaskEndpoint,
    getChatEndpoint,

    // Get models by provider (for ApiSettings)
    getModelsByProvider,

    // Clear all custom models
    clearCustomModels,

    // API Config by provider
    currentApiKey,
    currentBaseUrl,
    apiKeysByProvider,
    baseUrlsByProvider,
    setApiKeyByProvider,
    setBaseUrlByProvider,
    clearApiConfigByProvider
  }
})
