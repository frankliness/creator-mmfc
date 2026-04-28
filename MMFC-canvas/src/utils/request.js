/**
 * HTTP Request Utility | HTTP 请求工具
 * 集成版：所有请求走 Creator MMFC 主站 /api/canvas/*，
 * 由 Next.js 后端代理 Gemini，前端不再持有 API Key。
 */

import axios from 'axios'
import { DEFAULT_API_BASE_URL } from './constants'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL

const instance = axios.create({
  baseURL: BASE_URL,
  // 必须带 Cookie，复用主站 NextAuth 会话
  withCredentials: true,
  // 与 Gemini 长连接接口对齐，部分生图调用可能 >60s
  timeout: 180000
})

instance.interceptors.request.use(
  (config) => config,
  (error) => {
    console.error('[canvas-request] request error:', error)
    return Promise.reject(error)
  }
)

instance.interceptors.response.use(
  (res) => {
    if (res.config.responseType === 'stream') return res.data
    if (res.data instanceof Blob) return res.data
    return res.data
  },
  (error) => {
    const { response } = error

    if (response) {
      const { status, data } = response
      const message = data?.message || data?.error?.message || data?.error || error.message

      if (status === 401) {
        window.$message?.error('会话已失效，请刷新页面重新登录主站')
      } else if (status === 403) {
        window.$message?.error(message || '账户被管理员限制，无法继续使用画布')
      } else if (status === 429) {
        window.$message?.warning(message || '已达到今日配额上限')
      } else if (status >= 500) {
        window.$message?.error(message || '服务器错误，请稍后再试')
      } else {
        window.$message?.error(message || '请求失败')
      }
    } else {
      window.$message?.error(error.message || '网络错误')
    }

    return Promise.reject(error)
  }
)

export const setBaseUrl = (url) => {
  instance.defaults.baseURL = url
}

export const getBaseUrl = () => instance.defaults.baseURL

export default instance
