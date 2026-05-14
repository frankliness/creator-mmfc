<template>
  <div>
    <a-button v-if="canWritePrompts" type="primary" @click="showCreate = true" style="margin-bottom: 16px">新建模板</a-button>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="同一 slug 现在可以注册多条模板"
      description="通过『适用 Provider』字段区分。空 = 通用，所有 provider 都生效；填了某些 provider = 仅这些 provider 用此条目（优先级高于通用条目）。例：分镜 schema 可同时存在『通用版（Gemini 风格）』和『openai/azure 专用版（OpenAI structured output 风格）』。"
    />
    <a-table :columns="columns" :data-source="data" :loading="loading" row-key="id">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'category'">
          <a-tag
            :color="
              record.category === 'SYSTEM_PROMPT'
                ? 'blue'
                : record.category === 'JSON_SCHEMA'
                ? 'purple'
                : 'green'
            "
            >{{ record.category }}</a-tag
          >
        </template>
        <template v-if="column.key === 'applicableProviders'">
          <a-space wrap size="small">
            <a-tag
              v-if="!record.applicableProviders || (Array.isArray(record.applicableProviders) && record.applicableProviders.length === 0)"
              color="default"
            >
              通用
            </a-tag>
            <a-tag
              v-for="p in record.applicableProviders || []"
              :key="p"
              :color="providerColor(p)"
            >
              {{ providerLabel(p) }}
            </a-tag>
          </a-space>
        </template>
        <template v-if="column.key === 'active'">
          <a-tag :color="record.isActive ? 'green' : 'default'">{{
            record.isActive ? "已发布" : "草稿"
          }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="$router.push(`/prompts/${record.id}`)"
            >编辑</a-button
          >
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="showCreate" title="新建 Prompt 模板" width="640" @ok="handleCreate">
      <a-form layout="vertical">
        <a-form-item label="名称"><a-input v-model:value="createForm.name" /></a-form-item>
        <a-form-item label="Slug">
          <a-input v-model:value="createForm.slug" />
          <p style="margin: 4px 0 0; color: #999; font-size: 12px">
            同一 slug 可创建多条（用『适用 Provider』区分）。常用：director_system / storyboard_schema / user_prompt_template
          </p>
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="createForm.category">
            <a-select-option value="SYSTEM_PROMPT">系统提示词</a-select-option>
            <a-select-option value="JSON_SCHEMA">JSON Schema</a-select-option>
            <a-select-option value="USER_PROMPT">用户提示词模板</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="适用 Provider（留空 = 通用）">
          <a-select
            v-model:value="createForm.applicableProviders"
            mode="multiple"
            placeholder="留空表示所有 provider 通用；选了某些则仅适用这些"
            allow-clear
          >
            <a-select-option value="openai">OpenAI Compatible</a-select-option>
            <a-select-option value="azure_openai">Azure OpenAI</a-select-option>
            <a-select-option value="google">Google Gemini</a-select-option>
            <a-select-option value="custom">Custom</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="描述"><a-input v-model:value="createForm.description" /></a-form-item>
        <a-form-item label="内容">
          <a-textarea v-model:value="createForm.content" :rows="8" style="font-family: monospace" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getPrompts, createPrompt } from "@/api/prompts";
import { useUserStore } from "@/store/user";

const userStore = useUserStore();
const canWritePrompts = computed(() => userStore.canWrite("prompts"));

const data = ref([]);
const loading = ref(false);
const showCreate = ref(false);
const createForm = reactive<{
  name: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  applicableProviders: string[];
}>({
  name: "",
  slug: "",
  category: "SYSTEM_PROMPT",
  description: "",
  content: "",
  applicableProviders: [],
});

const columns = [
  { title: "名称", dataIndex: "name" },
  { title: "Slug", dataIndex: "slug" },
  { title: "类型", key: "category" },
  { title: "适用 Provider", key: "applicableProviders", width: 220 },
  { title: "版本", dataIndex: "version" },
  { title: "状态", key: "active" },
  {
    title: "更新时间",
    dataIndex: "updatedAt",
    customRender: ({ text }: any) => new Date(text).toLocaleString(),
  },
  { title: "操作", key: "action", width: 80 },
];

function providerLabel(p: string): string {
  const map: Record<string, string> = {
    openai: "OpenAI",
    azure_openai: "Azure",
    google: "Google",
    custom: "Custom",
  };
  return map[p] || p;
}

function providerColor(p: string): string {
  const map: Record<string, string> = {
    openai: "geekblue",
    azure_openai: "blue",
    google: "orange",
    custom: "default",
  };
  return map[p] || "default";
}

async function fetchData() {
  loading.value = true;
  try {
    data.value = (await getPrompts()) as any;
  } finally {
    loading.value = false;
  }
}

async function handleCreate() {
  const payload: Record<string, unknown> = {
    name: createForm.name,
    slug: createForm.slug,
    category: createForm.category,
    description: createForm.description,
    content: createForm.content,
  };
  if (createForm.applicableProviders.length > 0) {
    payload.applicableProviders = createForm.applicableProviders;
  }
  await createPrompt(payload);
  message.success("模板已创建");
  showCreate.value = false;
  Object.assign(createForm, {
    name: "",
    slug: "",
    category: "SYSTEM_PROMPT",
    description: "",
    content: "",
    applicableProviders: [],
  });
  fetchData();
}

onMounted(fetchData);
</script>
