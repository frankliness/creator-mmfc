/**
 * Chat API | 对话 API
 * 集成版：聊天直接打到主站 /api/canvas/chat，由后端做 SSE 转发与 token 记录。
 */

import { request } from '@/utils'

const CHAT_PATH = '/chat'

const resolveProjectId = (options = {}) => {
  return options.projectId || options.project_id || null
}

/**
 * 非流式聊天兼容接口（当前组件主要用流式，这里保留兜底）
 */
export const chatCompletions = (data, options = {}) => {
  return request({
    url: CHAT_PATH,
    method: 'post',
    data: {
      ...data,
      projectId: resolveProjectId(options),
      stream: false
    }
  })
}

/**
 * 流式聊天补全（SSE）。
 * 不再使用 axios，而是 fetch + ReadableStream，便于读取 chunk。
 * 后端会自动注入 Authorization 和 stream=true，前端只需传业务字段。
 */
export const streamChatCompletions = async function* (data, signal, options = {}) {
  const baseUrl = (typeof window !== 'undefined' && window.location?.origin) || ''
  const requestUrl = `${baseUrl}/api/canvas/chat`

  const body = {
    model: data.model,
    messages: data.messages,
    projectId: resolveProjectId(options),
    ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
    ...(data.max_tokens !== undefined ? { max_tokens: data.max_tokens } : {}),
    ...(data.reasoning_effort !== undefined ? { reasoning_effort: data.reasoning_effort } : {})
  }

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errJson = await response.json()
      detail = errJson?.error || errJson?.message || ''
    } catch {
      try { detail = await response.text() } catch { /* ignore */ }
    }
    if (response.status === 401) {
      throw new Error('会话已失效，请刷新页面重新登录主站')
    }
    if (response.status === 403) {
      throw new Error(detail || '账户被管理员限制，无法继续使用画布')
    }
    if (response.status === 429) {
      throw new Error(detail || '已达到今日聊天配额上限')
    }
    throw new Error(detail || `Stream request failed (HTTP ${response.status})`)
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
}
