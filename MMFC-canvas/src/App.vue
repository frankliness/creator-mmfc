<script setup>
/**
 * Root App component | 根组件
 * Provides naive-ui config and router view
 */
import { computed, onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme } from 'naive-ui'
import { isDark } from './stores/theme'
import MessageBridge from './components/MessageBridge.vue'
import { useModelStore } from '@/stores/pinia/models'

// 启动时拉一次后端 provider 配置 + 模型能力快照，
// 把 currentProvider 同步到 admin 在 GlobalConfig 里实际配置的 provider，
// 否则会出现「admin 切到 OpenAI，但前端 dropdown 还显示 Gemini 模型」的脱节。
const modelStore = useModelStore()
onMounted(() => {
  modelStore.initFromServer()
})

// Naive UI theme based on dark mode | 基于深色模式的 Naive UI 主题
const theme = computed(() => isDark.value ? darkTheme : null)

// Global theme overrides | 全局主题覆盖
const themeOverrides = {
  common: {
    borderRadius: '12px',
    borderRadiusSmall: '8px'
  },
  Dialog: {
    borderRadius: '16px',
    padding: '24px'
  },
  Modal: {
    borderRadius: '16px',
    padding: '24px'
  },
  Card: {
    borderRadius: '16px',
    padding: '24px'
  },
  Button: {
    borderRadiusMedium: '10px',
    borderRadiusSmall: '8px',
    borderRadiusLarge: '12px',
    heightMedium: '36px',
    paddingMedium: '0 16px'
  },
  Input: {
    borderRadius: '10px',
    heightMedium: '36px'
  }
}
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <MessageBridge />
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* Global app styles handled in style.css */
</style>
