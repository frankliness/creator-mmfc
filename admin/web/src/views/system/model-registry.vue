<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="画布前端的模型 dropdown 来自此处"
      description="新增模型 → 画布立即可见；禁用模型 → 画布立即隐藏；删除条目 → 仅删 DB 记录，已用过该 model 的历史调用不受影响。同一 modelKey 在不同 category 下可独立注册（如 gpt-image-1 同时在 canvas_image 和 canvas_image_edit）。"
    />

    <a-tabs v-model:activeKey="activeCategory" type="card" @change="fetchData">
      <a-tab-pane v-for="c in CATEGORIES" :key="c.key" :tab="c.label">
        <a-button type="primary" @click="openCreate" style="margin-bottom: 12px">
          + 新增模型
        </a-button>
        <a-table
          :columns="columns"
          :data-source="rows"
          :loading="loading"
          row-key="id"
          size="small"
          :pagination="false"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'isActive'">
              <a-switch :checked="record.isActive" @change="() => toggle(record)" />
            </template>
            <template v-if="column.key === 'providers'">
              <a-space wrap size="small">
                <a-tag v-for="p in record.providers || []" :key="p" :color="providerColor(p)">
                  {{ providerLabel(p) }}
                </a-tag>
              </a-space>
            </template>
            <template v-if="column.key === 'capabilities'">
              <a-space wrap size="small">
                <a-tag v-for="cap in capList(record.capabilities)" :key="cap" color="green">
                  {{ cap }}
                </a-tag>
              </a-space>
            </template>
            <template v-if="column.key === 'action'">
              <a-space size="small">
                <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
                <a-popconfirm title="确认删除？" @confirm="() => remove(record)">
                  <a-button type="link" danger size="small">删除</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="showDialog"
      :title="editing ? '编辑模型' : '新增模型'"
      width="720"
      @ok="submit"
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="modelKey（接口里 body.model 的实际值）">
              <a-input v-model:value="form.modelKey" :disabled="!!editing" placeholder="如 gpt-4o / gemini-3-pro-image-preview" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="显示名">
              <a-input v-model:value="form.label" placeholder="如 GPT-4o" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="Category（用途）">
              <a-select v-model:value="form.category" :disabled="!!editing">
                <a-select-option v-for="c in CATEGORIES" :key="c.key" :value="c.key">
                  {{ c.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="排序权重（小的在前）">
              <a-input-number v-model:value="form.sortOrder" :min="0" :max="9999" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="适用 Provider">
          <a-select v-model:value="form.providers" mode="multiple" placeholder="至少选一个">
            <a-select-option value="openai">OpenAI Compatible</a-select-option>
            <a-select-option value="azure_openai">Azure OpenAI</a-select-option>
            <a-select-option value="google">Google Gemini</a-select-option>
            <a-select-option value="custom">Custom</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="能力">
          <a-checkbox v-model:checked="capabilityFlags.imageGen">imageGen 文生图</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.imageEdit">imageEdit 图生图</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.vision">vision 多模态视觉</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.tools">tools 工具调用</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.jsonSchema">jsonSchema 结构化输出</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.jsonMode">jsonMode JSON 模式</a-checkbox>
          <a-checkbox v-model:checked="capabilityFlags.streaming">streaming 流式</a-checkbox>
          <div style="margin-top: 8px">
            <a-checkbox v-model:checked="advancedJson">高级：用 JSON 模式编辑（覆盖 checkbox）</a-checkbox>
            <a-textarea
              v-if="advancedJson"
              v-model:value="capabilitiesJson"
              :rows="4"
              style="font-family: monospace; margin-top: 4px"
              placeholder='{"imageGen":true,"imageEdit":false,"vision":true,...}'
            />
          </div>
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="可选 Sizes（JSON array，可空）">
              <a-textarea v-model:value="sizesJson" :rows="2" placeholder='["1:1","16:9","9:16"]' />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="可选 Qualities（JSON array，可空）">
              <a-textarea
                v-model:value="qualitiesJson"
                :rows="2"
                placeholder='[{"label":"HD","key":"hd"}]'
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item label="默认参数 defaultParams（JSON，可空）">
          <a-input
            v-model:value="defaultParamsJson"
            placeholder='{"size":"1:1","quality":"high"}'
          />
        </a-form-item>

        <a-form-item label="Tips（鼠标悬停文案，可空）">
          <a-input v-model:value="form.tips" />
        </a-form-item>

        <a-form-item>
          <a-checkbox v-model:checked="form.isActive">立即启用（前端可见）</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import {
  listModels,
  createModel,
  updateModel,
  toggleModel,
  deleteModel,
  type ModelEntry,
  type ModelCategory,
} from "@/api/model-registry";

const CATEGORIES: Array<{ key: ModelCategory; label: string }> = [
  { key: "chat", label: "聊天" },
  { key: "canvas_image", label: "画布文生图" },
  { key: "canvas_image_edit", label: "画布图生图" },
  { key: "storyboard", label: "分镜" },
];

const activeCategory = ref<ModelCategory>("chat");
const loading = ref(false);
const rows = ref<ModelEntry[]>([]);

const showDialog = ref(false);
const editing = ref<ModelEntry | null>(null);

interface FormState {
  modelKey: string;
  label: string;
  category: ModelCategory;
  providers: string[];
  tips: string;
  isActive: boolean;
  sortOrder: number;
}

const form = reactive<FormState>({
  modelKey: "",
  label: "",
  category: "chat",
  providers: [],
  tips: "",
  isActive: true,
  sortOrder: 100,
});

const capabilityFlags = reactive<Record<string, boolean>>({
  imageGen: false,
  imageEdit: false,
  vision: false,
  tools: false,
  jsonSchema: false,
  jsonMode: false,
  streaming: false,
});
const advancedJson = ref(false);
const capabilitiesJson = ref("");
const sizesJson = ref("");
const qualitiesJson = ref("");
const defaultParamsJson = ref("");

watch(advancedJson, (v) => {
  if (v) {
    // 切到 JSON 时，把 checkbox 当前值同步过去
    capabilitiesJson.value = JSON.stringify(capabilityFlags, null, 2);
  }
});

const columns = [
  { title: "modelKey", dataIndex: "modelKey", width: 220 },
  { title: "显示名", dataIndex: "label", width: 200 },
  { title: "Provider", key: "providers", width: 220 },
  { title: "能力", key: "capabilities" },
  { title: "排序", dataIndex: "sortOrder", width: 60 },
  { title: "启用", key: "isActive", width: 80 },
  { title: "操作", key: "action", width: 130 },
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

function capList(cap: Record<string, unknown>): string[] {
  if (!cap || typeof cap !== "object") return [];
  return Object.entries(cap)
    .filter(([_, v]) => v === true)
    .map(([k]) => k);
}

async function fetchData() {
  loading.value = true;
  try {
    rows.value = await listModels(activeCategory.value);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    modelKey: "",
    label: "",
    category: activeCategory.value,
    providers: [],
    tips: "",
    isActive: true,
    sortOrder: 100,
  });
  Object.keys(capabilityFlags).forEach((k) => (capabilityFlags[k] = false));
  advancedJson.value = false;
  capabilitiesJson.value = "";
  sizesJson.value = "";
  qualitiesJson.value = "";
  defaultParamsJson.value = "";
}

function openCreate() {
  editing.value = null;
  resetForm();
  showDialog.value = true;
}

function openEdit(record: ModelEntry) {
  editing.value = record;
  Object.assign(form, {
    modelKey: record.modelKey,
    label: record.label,
    category: record.category,
    providers: record.providers || [],
    tips: record.tips || "",
    isActive: record.isActive,
    sortOrder: record.sortOrder,
  });
  // capabilities → checkbox flags
  Object.keys(capabilityFlags).forEach((k) => (capabilityFlags[k] = false));
  if (record.capabilities && typeof record.capabilities === "object") {
    for (const [k, v] of Object.entries(record.capabilities)) {
      if (k in capabilityFlags) capabilityFlags[k] = !!v;
    }
  }
  advancedJson.value = false;
  capabilitiesJson.value = JSON.stringify(record.capabilities || {}, null, 2);
  sizesJson.value = record.sizes ? JSON.stringify(record.sizes) : "";
  qualitiesJson.value = record.qualities ? JSON.stringify(record.qualities) : "";
  defaultParamsJson.value = record.defaultParams ? JSON.stringify(record.defaultParams) : "";
  showDialog.value = true;
}

async function submit() {
  // 解析 capabilities：高级 JSON 模式优先
  let caps: Record<string, unknown>;
  if (advancedJson.value) {
    try {
      caps = JSON.parse(capabilitiesJson.value || "{}");
    } catch {
      message.error("Capabilities JSON 格式错误");
      return;
    }
  } else {
    caps = { ...capabilityFlags };
  }

  // 解析 sizes / qualities / defaultParams
  let sizes: unknown = null;
  let qualities: unknown = null;
  let defaultParams: unknown = null;
  try {
    if (sizesJson.value.trim()) sizes = JSON.parse(sizesJson.value);
    if (qualitiesJson.value.trim()) qualities = JSON.parse(qualitiesJson.value);
    if (defaultParamsJson.value.trim()) defaultParams = JSON.parse(defaultParamsJson.value);
  } catch {
    message.error("Sizes/Qualities/DefaultParams JSON 格式错误");
    return;
  }

  if (form.providers.length === 0) {
    message.error("至少选一个适用 Provider");
    return;
  }

  const payload: Record<string, unknown> = {
    modelKey: form.modelKey,
    label: form.label,
    category: form.category,
    providers: form.providers,
    capabilities: caps,
    sizes,
    qualities,
    defaultParams,
    tips: form.tips || null,
    isActive: form.isActive,
    sortOrder: form.sortOrder,
  };

  try {
    if (editing.value) {
      // 不允许改 modelKey/category（属于联合主键）
      delete payload.modelKey;
      delete payload.category;
      await updateModel(editing.value.id, payload);
      message.success("已更新");
    } else {
      await createModel(payload);
      message.success("已创建");
    }
    showDialog.value = false;
    fetchData();
  } catch (err) {
    // request interceptor 已弹错
  }
}

async function toggle(record: ModelEntry) {
  await toggleModel(record.id);
  fetchData();
}

async function remove(record: ModelEntry) {
  await deleteModel(record.id);
  message.success("已删除");
  fetchData();
}

onMounted(fetchData);
</script>
