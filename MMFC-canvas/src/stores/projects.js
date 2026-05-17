/**
 * Projects store | 项目状态管理
 * 集成版：所有持久化走 Creator MMFC 主站 /api/canvas/projects/*。
 *
 * 兼容性：保留旧接口名（createProject/updateProject/updateProjectCanvas/...），
 * 但全部改为 async 返回 Promise；调用方必须 await 才能拿到结果。
 */
import { ref, computed } from 'vue'
import request from '../utils/request'

// 项目列表 | Projects list
export const projects = ref([])

// 当前项目 ID | Current project ID
export const currentProjectId = ref(null)

// 当前项目是否可编辑（VIEWER 为 false）| Whether current project is editable
export const canEditProject = ref(true)

// v1.9.1: 客户端 id（用于审计与冲突日志，localStorage 持久化）
const CLIENT_ID_KEY = 'mmfc-canvas-client-id'
function ensureClientId () {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch (_e) {
    return 'c-fallback'
  }
}
export const clientId = ensureClientId()

// v1.9.1: 各项目的 baseVersion（由 fetchProjectDetail 返回，autosave 时回传）
// 如果发生冲突，置为 null 表示禁用 autosave 直到刷新
const projectVersions = new Map()
export const conflictedProjectIds = ref(new Set())
export const isProjectConflicted = (id) => conflictedProjectIds.value.has(id)
function markProjectConflict (id, detail) {
  if (!id) return
  if (!conflictedProjectIds.value.has(id)) {
    conflictedProjectIds.value = new Set([...conflictedProjectIds.value, id])
  }
  // 通知 UI 弹模态框
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('canvas:save-conflict', { detail: { projectId: id, ...detail } }))
  }
}
function clearProjectConflict (id) {
  if (!id || !conflictedProjectIds.value.has(id)) return
  const next = new Set(conflictedProjectIds.value)
  next.delete(id)
  conflictedProjectIds.value = next
}

// 当前项目（来自列表的 meta） | Current project (meta only)
export const currentProject = computed(() => {
  return projects.value.find(p => p.id === currentProjectId.value) || null
})

// 项目画布数据缓存：projectId -> { nodes, edges, viewport }
// canvas.js 在 loadProject 中先 await fetchProjectDetail，再 getProjectCanvas 同步取
const canvasDataCache = new Map()
const hydratedProjectIds = new Set()
const DEFAULT_VIEWPORT = { x: 100, y: 50, zoom: 0.8 }

const isEmptyCanvas = (canvasData) => {
  return (canvasData.nodes?.length || 0) === 0 && (canvasData.edges?.length || 0) === 0
}

// 缩略图自动从图片节点推断
const inferThumbnailFromNodes = (nodes = []) => {
  if (!Array.isArray(nodes)) return undefined
  const mediaNodes = nodes
    .filter(node => (node.type === 'image' || node.type === 'video') && node.data?.url)
    .sort((a, b) => {
      const aTime = a.data?.updatedAt || a.data?.createdAt || 0
      const bTime = b.data?.updatedAt || b.data?.createdAt || 0
      return bTime - aTime
    })
  if (mediaNodes.length === 0) return undefined
  const latest = mediaNodes[0]
  if (latest.type === 'video') {
    return latest.data.thumbnail || latest.data.url
  }
  return latest.data.url
}

// 把后端返回的项目 meta 标准化（updatedAt -> Date，便于排序）
const normalizeProject = (raw) => {
  if (!raw) return raw
  return {
    ...raw,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : new Date(),
    canvasData: undefined // canvas 数据走 cache，不放在 meta 列表里
  }
}

const upsertProjectInList = (project) => {
  const idx = projects.value.findIndex(p => p.id === project.id)
  if (idx === -1) {
    projects.value = [project, ...projects.value]
  } else {
    const merged = { ...projects.value[idx], ...project }
    projects.value.splice(idx, 1)
    projects.value = [merged, ...projects.value]
  }
}

/**
 * 拉取项目列表
 */
export const loadProjects = async () => {
  try {
    const list = await request({ url: '/projects', method: 'get' })
    projects.value = (Array.isArray(list) ? list : []).map(normalizeProject)
  } catch (err) {
    console.error('[projects] loadProjects failed:', err)
    projects.value = []
  }
}

/**
 * 拉取单个项目详情，并写入 canvasDataCache
 */
export const fetchProjectDetail = async (id) => {
  if (!id) return null
  try {
    const detail = await request({ url: `/projects/${id}`, method: 'get' })
    const canvasData = {
      nodes: Array.isArray(detail.nodes) ? detail.nodes : [],
      edges: Array.isArray(detail.edges) ? detail.edges : [],
      viewport: detail.viewport || DEFAULT_VIEWPORT
    }
    canvasDataCache.set(id, canvasData)
    hydratedProjectIds.add(id)
    upsertProjectInList(normalizeProject(detail))
    // Update global canEdit flag
    canEditProject.value = detail.canEdit !== false
    // v1.9.1: 记录基准版本，autosave 时回传
    if (typeof detail.version === 'number') {
      projectVersions.set(id, detail.version)
      clearProjectConflict(id)
    }
    return canvasData
  } catch (err) {
    console.error('[projects] fetchProjectDetail failed:', err)
    canvasDataCache.delete(id)
    hydratedProjectIds.delete(id)
    return null
  }
}

/**
 * 创建项目
 * @returns {Promise<string|null>} 新项目 ID
 */
export const createProject = async (arg = '未命名项目') => {
  const isObj = arg && typeof arg === 'object'
  const name = isObj ? (arg.name || '未命名项目') : (arg || '未命名项目')
  const seriesId = isObj ? (arg.seriesId || null) : null
  try {
    const created = await request({
      url: '/projects',
      method: 'post',
      data: seriesId ? { name, seriesId } : { name }
    })
    const normalized = normalizeProject(created)
    projects.value = [normalized, ...projects.value]
    canvasDataCache.set(normalized.id, {
      nodes: [],
      edges: [],
      viewport: normalized.viewport || DEFAULT_VIEWPORT
    })
    hydratedProjectIds.add(normalized.id)
    return normalized.id
  } catch (err) {
    console.error('[projects] createProject failed:', err)
    return null
  }
}

/**
 * 更新项目 meta（name/thumbnail/viewport/status）
 * VIEWER 角色（canEditProject=false）跳过
 */
export const updateProject = async (id, data = {}) => {
  if (!id) return false
  if (!canEditProject.value) return false  // VIEWER 跳过
  // 仅允许后端 patch 的字段
  const allow = ['name', 'thumbnail', 'viewport', 'status']
  const payload = {}
  for (const k of allow) {
    if (data[k] !== undefined) payload[k] = data[k]
  }
  if (Object.keys(payload).length === 0) {
    return false
  }
  try {
    const updated = await request({
      url: `/projects/${id}`,
      method: 'patch',
      data: payload
    })
    upsertProjectInList(normalizeProject(updated))
    return true
  } catch (err) {
    console.error('[projects] updateProject failed:', err)
    return false
  }
}

// 项目画布同步：debounce + flush，避免每次状态变更都请求后端
const SNAPSHOT_DEBOUNCE_MS = 800
const snapshotTimers = new Map()
const pendingPayloads = new Map()

const SNAPSHOT_RETRY_DELAYS_MS = [300, 900]

const isTransientError = (err) => {
  // 无 response = 网络中断 / fetch failed；5xx = 服务端瞬时故障
  if (!err?.response) return true
  const status = err.response.status
  return status >= 500 && status < 600
}

const flushSnapshot = async (id) => {
  const payload = pendingPayloads.get(id)
  if (!payload) return
  pendingPayloads.delete(id)

  // v1.9.1: 已冲突的项目，禁止 autosave 继续覆盖
  if (conflictedProjectIds.value.has(id)) {
    console.warn('[projects] snapshot save skipped, project in conflict state')
    return
  }

  // v1.9.1: 附加 baseVersion + clientId 给后端做乐观锁/审计
  const baseVersion = projectVersions.get(id)
  const sendPayload = {
    ...payload,
    ...(typeof baseVersion === 'number' ? { baseVersion } : {}),
    clientId
  }

  let lastErr = null
  for (let attempt = 0; attempt <= SNAPSHOT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const resp = await request({
        url: `/projects/${id}/snapshot`,
        method: 'put',
        data: sendPayload
      })
      // 成功：更新本地版本号供下次 autosave 使用
      const newVersion = resp?.data?.version ?? resp?.version
      if (typeof newVersion === 'number') {
        projectVersions.set(id, newVersion)
      }
      clearProjectConflict(id)
      return
    } catch (err) {
      lastErr = err
      const status = err?.response?.status
      const data = err?.response?.data
      if (status === 409) {
        if (data?.error === 'empty_snapshot_requires_confirm') return
        // STALE_BASE_VERSION / SNAPSHOT_SHRINK_DETECTED：标记冲突，停止 autosave
        markProjectConflict(id, {
          code: data?.code || 'UNKNOWN_CONFLICT',
          error: data?.error,
          message: data?.message,
          server: data?.server || null
        })
        console.warn('[projects] snapshot conflict, autosave halted:', data?.code || data?.error)
        return
      }
      if (status && status >= 400 && status < 500) {
        console.error('[projects] snapshot save failed (client error):', err)
        return
      }
      if (!isTransientError(err) || attempt >= SNAPSHOT_RETRY_DELAYS_MS.length) break
      const delay = SNAPSHOT_RETRY_DELAYS_MS[attempt]
      console.warn(`[projects] snapshot save transient error, retry ${attempt + 1} in ${delay}ms`, err?.message || err)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  console.error('[projects] snapshot save failed after retries:', lastErr)
}

/**
 * 更新项目画布数据（节点 + 边 + viewport），debounce 同步到后端
 * VIEWER 角色（canEditProject=false）直接跳过，避免触发 403 保存错误
 */
export const updateProjectCanvas = async (id, canvasData = {}) => {
  if (!id) return false
  if (!canEditProject.value) return false  // VIEWER 跳过
  // v1.9.1: 已发生冲突的项目，autosave 暂停直到用户刷新解决
  if (conflictedProjectIds.value.has(id)) return false

  const cached = canvasDataCache.get(id)
  const fallback = { nodes: [], edges: [], viewport: DEFAULT_VIEWPORT }
  const base = cached || fallback
  const merged = {
    nodes: canvasData.nodes ?? base.nodes,
    edges: canvasData.edges ?? base.edges,
    viewport: canvasData.viewport ?? base.viewport
  }

  if (!cached && !hydratedProjectIds.has(id) && isEmptyCanvas(merged)) {
    return false
  }

  canvasDataCache.set(id, merged)

  // 推断缩略图，写到 meta 列表里供首页显示（不会阻塞 snapshot）
  const inferredThumb = inferThumbnailFromNodes(merged.nodes)
  if (inferredThumb !== undefined) {
    const idx = projects.value.findIndex(p => p.id === id)
    if (idx !== -1) {
      projects.value[idx] = { ...projects.value[idx], thumbnail: inferredThumb }
    }
  }

  pendingPayloads.set(id, {
    nodes: merged.nodes,
    edges: merged.edges,
    viewport: merged.viewport,
    ...(canvasData.confirmEmptySnapshot === true ? { confirmEmptySnapshot: true } : {}),
    ...(inferredThumb !== undefined ? { thumbnail: inferredThumb } : {})
  })

  if (snapshotTimers.has(id)) {
    clearTimeout(snapshotTimers.get(id))
  }
  const timer = setTimeout(() => {
    snapshotTimers.delete(id)
    flushSnapshot(id)
  }, SNAPSHOT_DEBOUNCE_MS)
  snapshotTimers.set(id, timer)

  return true
}

/**
 * 获取已缓存的画布数据（同步）
 * canvas.js 中先 await fetchProjectDetail，再调用此函数取
 */
export const getProjectCanvas = (id) => {
  if (!id) return null
  return canvasDataCache.get(id) || null
}

/**
 * 删除项目（软删）
 */
export const deleteProject = async (id) => {
  if (!id) return false
  try {
    await request({ url: `/projects/${id}`, method: 'delete' })
    projects.value = projects.value.filter(p => p.id !== id)
    canvasDataCache.delete(id)
    hydratedProjectIds.delete(id)
    pendingPayloads.delete(id)
    if (snapshotTimers.has(id)) {
      clearTimeout(snapshotTimers.get(id))
      snapshotTimers.delete(id)
    }
    return true
  } catch (err) {
    console.error('[projects] deleteProject failed:', err)
    return false
  }
}

/**
 * 复制项目：先创建空项目，然后把源画布数据 PUT 进去
 */
export const duplicateProject = async (id) => {
  const source = projects.value.find(p => p.id === id)
  if (!source) return null

  // 确保有源数据
  let sourceCanvas = canvasDataCache.get(id)
  if (!sourceCanvas) {
    sourceCanvas = await fetchProjectDetail(id)
  }
  if (!sourceCanvas) return null

  const newId = await createProject(`${source.name} (副本)`)
  if (!newId) return null

  try {
    const cloned = JSON.parse(JSON.stringify(sourceCanvas))
    await request({
      url: `/projects/${newId}/snapshot`,
      method: 'put',
      data: {
        nodes: cloned.nodes || [],
        edges: cloned.edges || [],
        viewport: cloned.viewport || { x: 100, y: 50, zoom: 0.8 },
        ...(source.thumbnail ? { thumbnail: source.thumbnail } : {})
      }
    })
    canvasDataCache.set(newId, cloned)
    return newId
  } catch (err) {
    console.error('[projects] duplicateProject snapshot copy failed:', err)
    return newId
  }
}

export const renameProject = (id, name) => updateProject(id, { name })

export const updateProjectThumbnail = (id, thumbnail) => updateProject(id, { thumbnail })

/**
 * 获取排序后的项目列表（保留同步 computed 接口）
 */
export const getSortedProjects = (sortBy = 'updatedAt', order = 'desc') => {
  return computed(() => {
    const sorted = [...projects.value]
    sorted.sort((a, b) => {
      let valueA = a[sortBy]
      let valueB = b[sortBy]
      if (valueA instanceof Date) {
        valueA = valueA.getTime()
        valueB = valueB.getTime()
      }
      if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase()
        valueB = valueB.toLowerCase()
      }
      return order === 'asc'
        ? (valueA > valueB ? 1 : -1)
        : (valueA < valueB ? 1 : -1)
    })
    return sorted
  })
}

/**
 * 初始化：拉取列表，不再创建本地示例项目
 */
export const initProjectsStore = async () => {
  await loadProjects()
}

if (typeof window !== 'undefined') {
  window.__aiCanvasProjects = {
    projects,
    loadProjects,
    fetchProjectDetail,
    createProject,
    deleteProject
  }
}
