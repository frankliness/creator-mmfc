/**
 * Image API | 图片生成 API
 *
 * v1.4.0：异步任务模式。
 *   1. submitImageTask(data, options)：把请求 POST 给 /api/canvas/images，立刻返回 {taskId, status}
 *   2. pollImageTask(taskId, signal)：每 2s 查 /api/canvas/images/tasks/:id 直到 SUCCEEDED / FAILED
 *   3. generateImage(data, options)：兼容旧调用——内部 = submit + poll，等 SUCCEEDED 后返回
 *
 * 旧的同步 fetch 在 OpenAI gpt-image-1 / 慢 Gemini 上常常被 HTTP 超时打断，
 * 现在浏览器关 tab / 网络抖动也不会丢任务，前端拿 taskId 重连即可。
 */

import { request } from '@/utils'

const IMAGE_PATH = '/images'
const ASSETS_PATH = '/assets'
const TASK_PATH = '/images/tasks'

const POLL_INTERVAL_MS = 2000
/** 客户端轮询的总上限（防呆，超过这个时间就放弃；后端任务仍会跑完）。10 min。 */
const CLIENT_POLL_BUDGET_MS = 600_000

const buildPayload = (data, options) => {
  const projectId = options.projectId || options.project_id
  if (!projectId) {
    throw new Error('generateImage 缺少 projectId')
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
  return {
    projectId,
    model: data.model,
    prompt: data.prompt || '',
    ...(data.size ? { size: data.size } : {}),
    ...(data.quality ? { quality: data.quality } : {}),
    ...(data.sourceNodeId ? { sourceNodeId: data.sourceNodeId } : {}),
    ...(data.credentialId ? { credentialId: data.credentialId } : {}),
    ...(refImages.length > 0 ? { refImages } : {})
  }
}

/**
 * 提交一个图片生成任务，立刻返回 taskId。
 * @returns {Promise<{taskId, status, createdAt}>}
 */
export const submitImageTask = (data, options = {}) => {
  const payload = buildPayload(data, options)
  return request({
    url: IMAGE_PATH,
    method: 'post',
    data: payload
  })
}

/**
 * 用 taskId 轮询任务状态直到终态。
 * @param {string} taskId
 * @param {AbortSignal} [signal] 可中断
 * @param {Function} [onProgress] 每次拿到中间状态时回调（用于 UI 进度提示）
 * @returns {Promise<Object>} 终态 task 体（含 images / revisedPrompt 或 error）
 */
export const pollImageTask = async (taskId, signal, onProgress) => {
  if (!taskId) throw new Error('pollImageTask 缺少 taskId')
  const startedAt = Date.now()

  const sleep = (ms) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      if (signal) {
        const onAbort = () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        }
        if (signal.aborted) {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('aborted', 'AbortError')
    }
    if (Date.now() - startedAt > CLIENT_POLL_BUDGET_MS) {
      throw new Error('客户端轮询超时（任务可能仍在后台跑，刷新画布可恢复）')
    }

    const task = await request({ url: `${TASK_PATH}/${taskId}`, method: 'get' })

    if (task.status === 'SUCCEEDED') {
      return task
    }
    if (task.status === 'FAILED') {
      const err = new Error(task.error || '图片生成失败')
      err.task = task
      throw err
    }

    if (typeof onProgress === 'function') {
      try { onProgress(task) } catch (_) { /* ignore */ }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

/**
 * 兼容旧调用：submit + poll，最终返回 SUCCEEDED 时的 task 体（含 images / revisedPrompt）。
 *
 * 调用方（已存在的 ImageConfigNode 等）几乎不需要改：返回字段 images / revisedPrompt 与
 * v1.3.0 同步接口一致。但 **强烈建议**新代码改用 submitImageTask + pollImageTask 组合，
 * 把 taskId 持久化到节点，便于 resume on refresh。
 *
 * @param {Object} data
 * @param {Object} options - { projectId, signal?, onTaskCreated?, onProgress? }
 */
export const generateImage = async (data, options = {}) => {
  const submitted = await submitImageTask(data, options)
  if (typeof options.onTaskCreated === 'function') {
    try { options.onTaskCreated(submitted) } catch (_) { /* ignore */ }
  }
  const final = await pollImageTask(submitted.taskId, options.signal, options.onProgress)
  return {
    taskId: final.taskId,
    images: final.images || [],
    revisedPrompt: final.revisedPrompt || ''
  }
}

/**
 * 列出当前用户在某项目下的画布图任务（默认仅 active=PENDING+RUNNING）。
 * 画布加载时调一次以恢复在跑的轮询。
 *
 * @param {Object} options - { projectId, status?: 'active'|'all', limit? }
 */
export const listImageTasks = (options = {}) => {
  const projectId = options.projectId || options.project_id
  if (!projectId) {
    return Promise.reject(new Error('listImageTasks 缺少 projectId'))
  }
  const params = { projectId }
  if (options.status) params.status = options.status
  if (options.limit) params.limit = options.limit
  return request({ url: TASK_PATH, method: 'get', params })
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
