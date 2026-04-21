import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  // 集成到 Creator MMFC 主站后，画布以 iframe 形式挂在 `/canvas/` 子路径
  // 所有静态资源、router base、SPA fallback 都依赖这个值，请勿改回 '/'
  base: '/canvas/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
