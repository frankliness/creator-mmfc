<template>
  <n-modal v-model:show="showModal" preset="card" title="模型设置" style="width: 560px;">
    <n-alert type="info" class="mb-4">
      <template #header>API Key 由平台统一管理</template>
      <div class="text-sm leading-relaxed">
        画布的 Gemini API Key 由 Creator MMFC 平台后端统一注入，无需在此填写或保存。
        如需切换 Key 或调整额度，请联系平台管理员。
      </div>
    </n-alert>

    <div class="model-config-section">
      <div class="model-group">
        <div class="model-group-header">
          <span class="model-group-title">聊天模型</span>
          <n-tag size="tiny" type="info">{{ allChatModels.length }} 个</n-tag>
        </div>
        <div class="model-input-row">
          <n-input
            v-model:value="newChatModel"
            placeholder="输入模型名称，如 gemini-2.5-flash"
            size="small"
            @keyup.enter="handleAddChatModel"
          />
          <n-button size="small" type="primary" @click="handleAddChatModel" :disabled="!newChatModel">
            添加
          </n-button>
        </div>
        <div class="model-tags">
          <n-tag
            v-for="model in allChatModels"
            :key="model.key"
            size="small"
            :closable="model.isCustom"
            :type="model.isCustom ? 'info' : 'default'"
            @close="handleRemoveChatModel(model.key)"
          >
            {{ model.label }}
          </n-tag>
        </div>
      </div>

      <div class="model-group">
        <div class="model-group-header">
          <span class="model-group-title">图片模型</span>
          <n-tag size="tiny" type="success">{{ allImageModels.length }} 个</n-tag>
        </div>
        <div class="model-input-row">
          <n-input
            v-model:value="newImageModel"
            placeholder="输入模型名称，如 gemini-3.1-flash-image-preview"
            size="small"
            @keyup.enter="handleAddImageModel"
          />
          <n-button size="small" type="primary" @click="handleAddImageModel" :disabled="!newImageModel">
            添加
          </n-button>
        </div>
        <div class="model-tags">
          <n-tag
            v-for="model in allImageModels"
            :key="model.key"
            size="small"
            :closable="model.isCustom"
            :type="model.isCustom ? 'success' : 'default'"
            @close="handleRemoveImageModel(model.key)"
          >
            {{ model.label }}
          </n-tag>
        </div>
      </div>

      <n-alert type="warning" class="mt-2">
        当前集成版未启用 Gemini 视频生成接口，画布工具栏与节点菜单不再显示视频选项。
      </n-alert>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <n-button @click="handleClearCustomModels" tertiary>清除自定义模型</n-button>
        <n-button @click="showModal = false">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import {
  NModal,
  NInput,
  NButton,
  NAlert,
  NTag
} from 'naive-ui'
import { useModelStore } from '../stores/pinia'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show', 'saved'])
const modelStore = useModelStore()

const showModal = ref(props.show)
const newChatModel = ref('')
const newImageModel = ref('')

const allChatModels = computed(() => modelStore.allChatModels)
const allImageModels = computed(() => modelStore.allImageModels)

watch(() => props.show, (value) => { showModal.value = value })
watch(showModal, (value) => { emit('update:show', value) })

const handleAddChatModel = () => {
  if (!newChatModel.value.trim()) return
  modelStore.addCustomChatModel(newChatModel.value.trim())
  newChatModel.value = ''
  emit('saved')
}

const handleAddImageModel = () => {
  if (!newImageModel.value.trim()) return
  modelStore.addCustomImageModel(newImageModel.value.trim())
  newImageModel.value = ''
  emit('saved')
}

const handleRemoveChatModel = (modelKey) => {
  modelStore.removeCustomChatModel(modelKey)
  emit('saved')
}

const handleRemoveImageModel = (modelKey) => {
  modelStore.removeCustomImageModel(modelKey)
  emit('saved')
}

const handleClearCustomModels = () => {
  modelStore.clearCustomModels()
  emit('saved')
}
</script>

<style scoped>
.model-config-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-group {
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 10px;
}

.model-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.model-group-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.model-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.model-input-row .n-input {
  flex: 1;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
</style>
