/**
 * Image API | 图片生成 API
 * 集成版：固定打到主站 /api/canvas/images，由后端调 Gemini，
 * 写盘 + 落库 CanvasAsset / CanvasAiCall / TokenUsageLog。
 */

import { request } from '@/utils'

const IMAGE_PATH = '/images'
const ASSETS_PATH = '/assets'

/**
 * 生成或编辑图片。
 * @param {Object} data - { model, prompt, size, quality, image?, sourceNodeId? }
 * @param {Object} options - { projectId } 必填
 * @returns {Promise<{images: Array<{url, mimeType, bytes, assetId}>, revisedPrompt: string}>}
 */
export const generateImage = (data, options = {}) => {
  const projectId = options.projectId || options.project_id
  if (!projectId) {
    return Promise.reject(new Error('generateImage 缺少 projectId'))
  }

  // 兼容旧调用：image 字段统一映射成 refImages 数组
  const refImages = []
  if (data.image) {
    if (Array.isArray(data.image)) refImages.push(...data.image)
    else refImages.push(data.image)
  }
  if (Array.isArray(data.refImages)) {
    refImages.push(...data.refImages)
  }

  const payload = {
    projectId,
    model: data.model,
    prompt: data.prompt || '',
    ...(data.size ? { size: data.size } : {}),
    ...(data.quality ? { quality: data.quality } : {}),
    ...(data.sourceNodeId ? { sourceNodeId: data.sourceNodeId } : {}),
    ...(refImages.length > 0 ? { refImages } : {})
  }

  return request({
    url: IMAGE_PATH,
    method: 'post',
    data: payload
  })
}

/**
 * 上传参考图到画布资产库。multipart/form-data。
 * @param {File|Blob} file
 * @param {Object} options - { projectId, sourceNodeId? }
 */
export const uploadAsset = (file, options = {}) => {
  const projectId = options.projectId || options.project_id
  if (!projectId) {
    return Promise.reject(new Error('uploadAsset 缺少 projectId'))
  }

  const form = new FormData()
  form.append('file', file)
  form.append('projectId', projectId)
  if (options.sourceNodeId) form.append('sourceNodeId', options.sourceNodeId)

  return request({
    url: ASSETS_PATH,
    method: 'post',
    data: form
  })
}
