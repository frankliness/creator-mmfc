<template>
  <!-- App Header | 应用头部 -->
  <header class="flex items-center justify-between px-4 md:px-8 py-4 border-b border-[var(--border-color)]">
    <!-- Left slot | 左侧插槽 -->
    <div class="flex items-center gap-2">
      <slot name="left">
        <BrandLogo :icon-size="36" subtitle="" />
      </slot>
    </div>
    
    <!-- Right section | 右侧区域 -->
    <div class="flex items-center gap-4">
      <!-- Center slot | 中间插槽 -->
      <slot name="center"></slot>

      <!-- 返回主站（仅在 iframe 内显示，由父页面接管路由跳转） -->
      <button
        v-if="isInIframe"
        @click="handleBackToMain"
        class="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-1.5"
        title="返回 Creator MMFC 主站"
      >
        <n-icon :size="16"><ArrowBackOutline /></n-icon>
        <span>返回主站</span>
      </button>

      <!-- GitHub link | GitHub 链接 -->
      <a
        v-if="githubUrl"
        :href="githubUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-primary)] hover:text-[var(--accent-color)]"
        title="GitHub"
      >
        <n-icon :size="20"><LogoGithub /></n-icon>
      </a>
      
      <!-- Theme toggle | 主题切换 -->
      <button 
        @click="toggleTheme"
        class="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <n-icon :size="20">
          <SunnyOutline v-if="isDark" />
          <MoonOutline v-else />
        </n-icon>
      </button>
      
      <!-- Right slot | 右侧插槽 -->
      <slot name="right"></slot>
    </div>
  </header>
</template>

<script setup>
/**
 * App Header component | 应用头部组件
 * Reusable header with slots for customization
 */
import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import {
  SunnyOutline,
  MoonOutline,
  LogoGithub,
  ArrowBackOutline
} from '@vicons/ionicons5'
import { isDark, toggleTheme } from '../stores/theme'
import BrandLogo from './BrandLogo.vue'

defineProps({
  githubUrl: {
    type: String,
    default: ''
  }
})

// 仅在被嵌入主站 iframe 时才显示"返回主站"按钮
const isInIframe = computed(() => {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    // 跨域时访问 window.top 会抛错 —— 同源 iframe 走这里返回 true
    return true
  }
})

// 通过 postMessage 把跳转交给父窗口（同源主站）处理
const handleBackToMain = () => {
  if (typeof window === 'undefined') return
  try {
    window.parent?.postMessage({ type: 'creator-mmfc:canvas:back', target: '/dashboard' }, window.location.origin)
  } catch (err) {
    console.warn('[AppHeader] postMessage failed:', err)
  }
}
</script>
