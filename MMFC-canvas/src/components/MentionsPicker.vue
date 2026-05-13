<template>
  <n-popover
    :show="isShow"
    trigger="manual"
    placement="bottom-start"
    :x="position.x"
    :y="position.y"
    :style="{ padding: 0 }"
    raw
    :show-arrow="false"
    @update:show="handleShowChange"
  >
    <div class="mentions-picker">
      <div class="mentions-search" v-if="showSearch">
        <n-input
          v-model:value="searchQuery"
          placeholder="搜索节点..."
          size="small"
          :autofocus="true"
          @keydown="handleKeydown"
        />
      </div>
      <div class="mentions-list" v-if="filteredNodes.length > 0">
        <div
          v-for="(node, index) in filteredNodes"
          :key="node.id"
          class="mentions-item"
          :class="{ active: index === selectedIndex }"
          @click="selectNode(node)"
          @mouseenter="handleItemMouseenter(node, index)"
          @mouseleave="handleItemMouseleave(node)"
        >
          <!-- ImageNode 显示图片预览 -->
          <div v-if="node.type === 'image'" class="mentions-item-image">
            <img v-if="node.data?.url" :src="node.data.url" :alt="getDisplayName(node)" />
            <div v-else class="mentions-item-image-placeholder">
              <n-icon :size="20"><ImageOutline /></n-icon>
            </div>
          </div>
          <!-- 非 ImageNode 显示图标 -->
          <div v-else class="mentions-item-icon">
            <n-icon :component="getNodeIcon(node.type)" />
          </div>
          <div class="mentions-item-content">
            <div class="mentions-item-label">
              {{ getDisplayName(node) }}
            </div>
            <div class="mentions-item-id">{{ node.id }}</div>
          </div>
        </div>
      </div>
      <div class="mentions-empty" v-else>
        <span>没有可引用的节点</span>
      </div>
      <div v-if="hoverPreviewNode?.data?.url" class="mentions-preview-panel">
        <img :src="hoverPreviewNode.data.url" :alt="getDisplayName(hoverPreviewNode)" />
        <div class="mentions-preview-label">{{ getDisplayName(hoverPreviewNode) }}</div>
      </div>
    </div>
  </n-popover>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NPopover, NInput, NIcon } from 'naive-ui'
import { ImageOutline } from '@vicons/ionicons5'
import { nodes } from '@/stores/canvas'

const props = defineProps({
  // 可见性
  visible: {
    type: Boolean,
    default: false
  },
  // 位置
  position: {
    type: Object,
    default: () => ({ x: 0, y: 0 })
  },
  // 上下文类型：'text' | 'llmConfig'
  context: {
    type: String,
    default: 'text'
  },
  // 是否显示搜索框
  showSearch: {
    type: Boolean,
    default: true
  },
  // 限制只显示已连接的节点 ID 列表（可选）
  connectedNodeIds: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:visible', 'select'])

const searchQuery = ref('')
const selectedIndex = ref(0)
const isShow = ref(false)
const hoverPreviewNode = ref(null)

// Sync with prop | 与 prop 同步
watch(() => props.visible, (newVal) => {
  isShow.value = newVal
}, { immediate: true })

// Handle show change | 处理显示变化
const handleShowChange = (val) => {
  isShow.value = val
  if (!val) {
    emit('update:visible', false)
  }
}

// 根据上下文获取可引用的节点类型
const targetTypes = computed(() => {
  if (props.context === 'llmConfig') {
    return ['text']
  }
  return ['image']
})

// 检查节点是否公开（仅 ImageNode 需要检查 publicProps.name）
const isNodePublic = (node) => {
  if (node.type === 'image') {
    // ImageNode 需要有 publicProps.name 才算公开
    return node.data?.publicProps?.name && node.data.publicProps.name !== ''
  }
  // 其他节点类型默认公开
  return true
}

const getDisplayName = (node) => {
  if (node.type === 'image') {
    return node.data?.label || node.data?.publicProps?.name || '未命名'
  }
  return node.data?.label || node.id
}

// 可引用的节点列表
const availableNodes = computed(() => {
  return nodes.value.filter(node => {
    // 先检查类型
    if (!targetTypes.value.includes(node.type)) return false
    // 再检查是否公开
    if (!isNodePublic(node)) return false
    // 如果指定了 connectedNodeIds，则只显示已连接的节点
    if (props.connectedNodeIds.length > 0) {
      return props.connectedNodeIds.includes(node.id)
    }
    return true
  })
})

// 过滤后的节点列表
const filteredNodes = computed(() => {
  if (!searchQuery.value) {
    return availableNodes.value
  }

  const query = searchQuery.value.toLowerCase()
  return availableNodes.value.filter(node => {
    const label = getDisplayName(node).toLowerCase()
    const name = node.data?.publicProps?.name?.toLowerCase() || ''
    const id = node.id.toLowerCase()
    return label.includes(query) || name.includes(query) || id.includes(query)
  })
})

// 监听搜索变化，重置选中索引
watch(searchQuery, () => {
  selectedIndex.value = 0
})

// 监听可见性变化，重置搜索
watch(() => props.visible, (newVal) => {
  if (newVal) {
    searchQuery.value = ''
    selectedIndex.value = 0
    hoverPreviewNode.value = null
    // 添加全局键盘事件监听
    document.addEventListener('keydown', handleGlobalKeydown)
  } else {
    hoverPreviewNode.value = null
    // 移除全局键盘事件监听
    document.removeEventListener('keydown', handleGlobalKeydown)
  }
})

// 全局键盘事件处理（用于在选择器显示时处理 Enter/Escape）
function handleGlobalKeydown(event) {
  if (!isShow.value) return

  if (event.key === 'Enter') {
    event.preventDefault()
    if (filteredNodes.value[selectedIndex.value]) {
      selectNode(filteredNodes.value[selectedIndex.value])
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    isShow.value = false
    emit('update:visible', false)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredNodes.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  }
}

// 获取节点图标
function getNodeIcon(type) {
  const icons = {
    image: '📷',
    text: '📝',
    llmConfig: '🤖',
    imageConfig: '🎨',
    video: '🎬',
    videoConfig: '🎥'
  }
  return icons[type] || '📄'
}

// 选择节点
function selectNode(node) {
  const displayName = getDisplayName(node)

  emit('select', {
    nodeId: node.id,
    label: displayName,
    type: node.type
  })
  isShow.value = false
  emit('update:visible', false)
}

function handleItemMouseenter(node, index) {
  selectedIndex.value = index
  hoverPreviewNode.value = node.type === 'image' && node.data?.url ? node : null
}

function handleItemMouseleave(node) {
  if (hoverPreviewNode.value?.id === node.id) {
    hoverPreviewNode.value = null
  }
}

// 键盘导航
function handleKeydown(event) {
  const { key } = event

  if (key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredNodes.value.length - 1)
  } else if (key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (key === 'Enter') {
    event.preventDefault()
    if (filteredNodes.value[selectedIndex.value]) {
      selectNode(filteredNodes.value[selectedIndex.value])
    }
  } else if (key === 'Escape') {
    event.preventDefault()
    isShow.value = false
    emit('update:visible', false)
  }
}
</script>

<style scoped>
.mentions-picker {
  position: relative;
  width: 360px;
  max-height: 380px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: visible;
}

.mentions-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.mentions-list {
  max-height: 320px;
  overflow-y: auto;
}

.mentions-item {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.mentions-item:hover,
.mentions-item.active {
  background: var(--hover-bg, #f5f5f5);
}

.mentions-item-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--bg-color, #f0f0f0);
  border-radius: 6px;
  margin-right: 10px;
}

.mentions-item-image {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  margin-right: 10px;
  flex-shrink: 0;
  background: var(--bg-color, #f0f0f0);
}

.mentions-item-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mentions-item-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color, #f0f0f0);
  color: var(--text-secondary, #999);
}

.mentions-item-content {
  flex: 1;
  min-width: 0;
}

.mentions-item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mentions-item-id {
  font-size: 11px;
  color: var(--text-secondary, #999);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mentions-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary, #999);
  font-size: 13px;
}

.mentions-preview-panel {
  position: absolute;
  left: calc(100% + 8px);
  top: 0;
  width: 240px;
  padding: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #eee);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.mentions-preview-panel img {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--bg-color, #f0f0f0);
}

.mentions-preview-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-color, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
