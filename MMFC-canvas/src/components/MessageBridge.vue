<script setup>
/**
 * 将 naive-ui useMessage 挂到 window.$message，供 axios 拦截器与各节点里
 * window.$message?.xxx 使用；否则可选链会整体 no-op，用户感知为「静默失败」。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useMessage } from 'naive-ui'

const message = useMessage()

onMounted(() => {
  window.$message = message
})

onBeforeUnmount(() => {
  if (window.$message === message) {
    delete window.$message
  }
})
</script>

<template></template>
