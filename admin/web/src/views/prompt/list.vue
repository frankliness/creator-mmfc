<template>
  <div>
    <a-button type="primary" @click="showCreate = true" style="margin-bottom: 16px">新建模板</a-button>
    <a-table :columns="columns" :data-source="data" :loading="loading" row-key="id">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'category'">
          <a-tag :color="record.category === 'SYSTEM_PROMPT' ? 'blue' : record.category === 'JSON_SCHEMA' ? 'purple' : 'green'">{{ record.category }}</a-tag>
        </template>
        <template v-if="column.key === 'active'">
          <a-tag :color="record.isActive ? 'green' : 'default'">{{ record.isActive ? '已发布' : '草稿' }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="$router.push(`/prompts/${record.id}`)">编辑</a-button>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="showCreate" title="新建 Prompt 模板" @ok="handleCreate">
      <a-form layout="vertical">
        <a-form-item label="名称"><a-input v-model:value="createForm.name" /></a-form-item>
        <a-form-item label="Slug"><a-input v-model:value="createForm.slug" /></a-form-item>
        <a-form-item label="类型"><a-select v-model:value="createForm.category">
          <a-select-option value="SYSTEM_PROMPT">系统提示词</a-select-option>
          <a-select-option value="JSON_SCHEMA">JSON Schema</a-select-option>
          <a-select-option value="USER_PROMPT">用户提示词模板</a-select-option>
        </a-select></a-form-item>
        <a-form-item label="描述"><a-input v-model:value="createForm.description" /></a-form-item>
        <a-form-item label="内容"><a-textarea v-model:value="createForm.content" :rows="6" /></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getPrompts, createPrompt } from "@/api/prompts";

const data = ref([]);
const loading = ref(false);
const showCreate = ref(false);
const createForm = reactive({ name: "", slug: "", category: "SYSTEM_PROMPT", description: "", content: "" });

const columns = [
  { title: "名称", dataIndex: "name" },
  { title: "Slug", dataIndex: "slug" },
  { title: "类型", key: "category" },
  { title: "版本", dataIndex: "version" },
  { title: "状态", key: "active" },
  { title: "更新时间", dataIndex: "updatedAt", customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "操作", key: "action", width: 80 },
];

async function fetchData() {
  loading.value = true;
  try { data.value = (await getPrompts()) as any; } finally { loading.value = false; }
}

async function handleCreate() {
  await createPrompt(createForm);
  message.success("模板已创建");
  showCreate.value = false;
  fetchData();
}

onMounted(fetchData);
</script>
