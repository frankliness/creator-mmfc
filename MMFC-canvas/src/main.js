/**
 * Main entry point | 主入口
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { startMemDebug } from './utils/memDebug'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

// Dev-only：每 30s console.warn 一次堆内存占用，便于排查 OOM；prod 自动 no-op
startMemDebug()
