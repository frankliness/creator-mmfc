<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="共享凭据池"
      description="同一 Provider 类型可有多条凭据（生产 / 测试 / 多区域 / 不同部署）。模型会按 Provider、业务类型、模型范围匹配「主用」凭据；已禁用的凭据不会参与匹配。"
    />

    <a-space style="margin-bottom: 12px">
      <a-button type="primary" @click="openCreate">+ 新增凭据</a-button>
      <a-select v-model:value="filterProvider" allow-clear placeholder="筛选 Provider" style="width: 200px" @change="fetchData">
        <a-select-option v-for="p in PROVIDER_TYPES" :key="p.key" :value="p.key">{{ p.label }}</a-select-option>
      </a-select>
    </a-space>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      row-key="id"
      size="small"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'provider'">
          <a-tag :color="providerColor(record.provider)">{{ providerLabel(record.provider) }}</a-tag>
        </template>
        <template v-if="column.key === 'isPrimary'">
          <a-tag v-if="record.isPrimary" color="gold">主用</a-tag>
          <a-button v-else type="link" size="small" @click="setPrimary(record)">设为主用</a-button>
        </template>
        <template v-if="column.key === 'purposes'">
          <a-space size="small" wrap>
            <a-tag v-for="p in record.purposes" :key="p">{{ purposeLabel(p) }}</a-tag>
          </a-space>
        </template>
        <template v-if="column.key === 'modelKeys'">
          <span v-if="!record.modelKeys?.length" style="color: #999">全部模型</span>
          <a-space v-else size="small" wrap>
            <a-tag v-for="m in record.modelKeys" :key="m" color="blue">{{ m }}</a-tag>
          </a-space>
        </template>
        <template v-if="column.key === 'isActive'">
          <a-switch :checked="record.isActive" @change="() => toggle(record)" />
        </template>
        <template v-if="column.key === 'concurrency'">
          <span>{{ record.concurrency }}</span>
        </template>
        <template v-if="column.key === 'cooldownUntil'">
          <a-tag v-if="isCooling(record.cooldownUntil)" color="red">
            冷却中 · 至 {{ formatCooldown(record.cooldownUntil) }}
          </a-tag>
          <span v-else style="color: #999">—</span>
        </template>
        <template v-if="column.key === 'action'">
          <a-space size="small">
            <a-button type="link" size="small" @click="testOne(record)" :loading="testingId === record.id">
              测试
            </a-button>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除？引用此凭据的 UserApiConfig 将自动断开关联。" @confirm="() => remove(record)">
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="showDialog"
      :title="editing ? `编辑凭据：${editing.name}` : '新增凭据'"
      width="640"
      @ok="submit"
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="Provider 类型" required>
              <a-select v-model:value="form.provider" :disabled="!!editing">
                <a-select-option v-for="p in PROVIDER_TYPES" :key="p.key" :value="p.key">
                  {{ p.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="名称（自由命名）" required>
              <a-input v-model:value="form.name" placeholder="如 OpenAI 主号 / Azure 测试" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="适用业务类型" required>
          <a-select v-model:value="form.purposes" mode="multiple" placeholder="请选择该凭据可用于哪些业务">
            <a-select-option v-for="p in PURPOSE_TYPES" :key="p.key" :value="p.key">
              {{ p.label }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="适用模型 Key（可选）">
          <a-input
            v-model:value="form.modelKeysText"
            placeholder="留空表示全部模型；多个模型用英文逗号分隔，如 gpt-5.5,gpt-4o"
          />
        </a-form-item>
        <a-form-item label="Base URL" required>
          <a-input
            v-model:value="form.baseUrl"
            :placeholder="baseUrlPlaceholder"
          />
          <div style="color: #999; font-size: 12px; margin-top: 4px">
            <div v-for="line in baseUrlHelp" :key="line">{{ line }}</div>
          </div>
        </a-form-item>
        <a-form-item :label="editing ? 'API Key（留空 = 不修改）' : 'API Key'" :required="!editing">
          <a-input-password v-model:value="form.apiKey" :placeholder="editing ? '****（保留原值）' : ''" />
        </a-form-item>
        <a-row v-if="form.provider === 'azure_openai'" :gutter="16">
          <a-col :span="12">
            <a-form-item label="Deployment（Azure 部署名）">
              <a-input v-model:value="form.deployment" placeholder="如 gpt-4o-prod" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="API Version">
              <a-input v-model:value="form.apiVersion" placeholder="如 2024-08-01-preview" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="设为主用">
              <a-switch v-model:checked="form.isPrimary" />
              <span style="color: #999; font-size: 12px; margin-left: 8px">
                同 provider + 业务类型 + 模型范围内只能有一条主用
              </span>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="启用">
              <a-switch v-model:checked="form.isActive" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="备注">
          <a-textarea v-model:value="form.remark" :rows="2" />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="排序权重（小的在前）">
              <a-input-number v-model:value="form.sortOrder" :min="0" :max="9999" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="并发上限（画布生图）">
              <a-input-number v-model:value="form.concurrency" :min="1" :max="200" style="width: 100%" />
              <div style="color: #999; font-size: 12px; margin-top: 4px">
                Azure gpt-image-2 实测约 6；多渠道之和 = 实际可用画布并发。
              </div>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  toggleCredential,
  setPrimaryCredential,
  testCredential,
  type Credential,
  type CredentialInput,
  type CredentialPurpose,
  type ProviderType,
} from "@/api/credentials";

const PROVIDER_TYPES = [
  { key: "openai", label: "OpenAI Compatible" },
  { key: "azure_openai", label: "Azure OpenAI" },
  { key: "google", label: "Google Gemini" },
  { key: "custom", label: "Custom" },
];

const PURPOSE_TYPES: Array<{ key: CredentialPurpose; label: string }> = [
  { key: "chat", label: "画布 Chat" },
  { key: "storyboard", label: "分镜生成" },
  { key: "canvas_image", label: "文生图" },
  { key: "canvas_image_edit", label: "图生图" },
];

const PROVIDER_COLORS: Record<string, string> = {
  openai: "blue",
  azure_openai: "purple",
  google: "cyan",
  custom: "default",
};

const filterProvider = ref<ProviderType | undefined>(undefined);
const rows = ref<Credential[]>([]);
const loading = ref(false);
const testingId = ref<string | null>(null);

const showDialog = ref(false);
const editing = ref<Credential | null>(null);

const form = reactive<Required<Omit<CredentialInput, "deployment" | "apiVersion" | "remark">> & {
  deployment: string;
  apiVersion: string;
  remark: string;
  purposes: CredentialPurpose[];
  modelKeysText: string;
}>({
  provider: "openai",
  name: "",
  baseUrl: "",
  apiKey: "",
  deployment: "",
  apiVersion: "",
  purposes: ["chat"],
  modelKeys: null,
  modelKeysText: "",
  isActive: true,
  isPrimary: false,
  sortOrder: 100,
  remark: "",
  concurrency: 6,
});

const baseUrlPlaceholder = computed(() => {
  switch (form.provider) {
    case "openai":
      return "如 https://api.openai.com/v1";
    case "azure_openai":
      return "如 https://my-resource.openai.azure.com";
    case "google":
      return "如 https://generativelanguage.googleapis.com/v1beta";
    default:
      return "如 https://api.your-provider.com/v1";
  }
});

const baseUrlHelp = computed(() => {
  switch (form.provider) {
    case "openai":
      return [
        "OpenAI Compatible：填写 https://api.openai.com/v1",
        "可粘贴完整 endpoint URL（如 .../chat/completions），保存时自动剥后缀",
      ];
    case "azure_openai":
      return [
        "Azure OpenAI：填写 https://<resource>.openai.azure.com",
        "Deployment 和 API Version 请在下方独立填写，不要拼进 Base URL",
      ];
    case "google":
      return ["Google Gemini：填写 https://generativelanguage.googleapis.com/v1beta"];
    default:
      return [
        "Custom：需兼容 OpenAI 路径规范，推荐以 /v1 结尾",
        "可粘贴完整 endpoint URL（如 .../chat/completions），保存时自动剥后缀",
      ];
  }
});

const columns = [
  { title: "Provider", dataIndex: "provider", key: "provider", width: 160 },
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "业务类型", dataIndex: "purposes", key: "purposes", width: 220 },
  { title: "模型范围", dataIndex: "modelKeys", key: "modelKeys", width: 220 },
  { title: "Base URL", dataIndex: "baseUrl", key: "baseUrl", ellipsis: true },
  { title: "API Key", dataIndex: "apiKeyMasked", key: "apiKeyMasked", width: 200 },
  { title: "并发", dataIndex: "concurrency", key: "concurrency", width: 80 },
  { title: "冷却", dataIndex: "cooldownUntil", key: "cooldownUntil", width: 180 },
  { title: "主用", dataIndex: "isPrimary", key: "isPrimary", width: 120 },
  { title: "启用", dataIndex: "isActive", key: "isActive", width: 80 },
  { title: "操作", key: "action", width: 220 },
];

function isCooling(value: string | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function formatCooldown(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

const providerLabel = (p: string) => PROVIDER_TYPES.find((x) => x.key === p)?.label || p;
const providerColor = (p: string) => PROVIDER_COLORS[p] || "default";
const purposeLabel = (p: string) => PURPOSE_TYPES.find((x) => x.key === p)?.label || p;

const fetchData = async () => {
  loading.value = true;
  try {
    rows.value = await listCredentials(filterProvider.value);
  } catch (e: any) {
    message.error(e?.message || "加载失败");
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  form.provider = "openai";
  form.name = "";
  form.baseUrl = "";
  form.apiKey = "";
  form.deployment = "";
  form.apiVersion = "";
  form.purposes = ["chat"];
  form.modelKeysText = "";
  form.isActive = true;
  form.isPrimary = false;
  form.sortOrder = 100;
  form.remark = "";
  form.concurrency = 6;
};

const openCreate = () => {
  editing.value = null;
  resetForm();
  showDialog.value = true;
};

const openEdit = (rec: Credential) => {
  editing.value = rec;
  form.provider = rec.provider;
  form.name = rec.name;
  form.baseUrl = rec.baseUrl;
  form.apiKey = "";
  form.deployment = rec.deployment ?? "";
  form.apiVersion = rec.apiVersion ?? "";
  form.purposes = rec.purposes?.length ? [...rec.purposes] : ["chat", "storyboard", "canvas_image", "canvas_image_edit"];
  form.modelKeysText = rec.modelKeys?.join(",") ?? "";
  form.isActive = rec.isActive;
  form.isPrimary = rec.isPrimary;
  form.sortOrder = rec.sortOrder;
  form.remark = rec.remark ?? "";
  form.concurrency = rec.concurrency ?? 6;
  showDialog.value = true;
};

const submit = async () => {
  if (!form.name.trim() || !form.baseUrl.trim()) {
    message.warning("名称、Base URL 必填");
    return;
  }
  if (!editing.value && !form.apiKey.trim()) {
    message.warning("新建时必须填写 API Key");
    return;
  }
  if (!form.purposes.length) {
    message.warning("请至少选择一个适用业务类型");
    return;
  }

  const modelKeys = form.modelKeysText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const payload: CredentialInput = {
    provider: form.provider,
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    deployment: form.deployment.trim() || null,
    apiVersion: form.apiVersion.trim() || null,
    purposes: form.purposes,
    modelKeys: modelKeys.length > 0 ? modelKeys : null,
    isActive: form.isActive,
    isPrimary: form.isPrimary,
    sortOrder: form.sortOrder,
    remark: form.remark.trim() || null,
    concurrency: form.concurrency,
  };
  if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();

  try {
    if (editing.value) {
      await updateCredential(editing.value.id, payload);
      message.success("已更新");
    } else {
      await createCredential(payload);
      message.success("已创建");
    }
    showDialog.value = false;
    await fetchData();
  } catch (e: any) {
    message.error(e?.message || "保存失败");
  }
};

const toggle = async (rec: Credential) => {
  try {
    await toggleCredential(rec.id);
    await fetchData();
  } catch (e: any) {
    message.error(e?.message || "切换失败");
  }
};

const setPrimary = async (rec: Credential) => {
  try {
    await setPrimaryCredential(rec.id);
    message.success(`${rec.name} 已设为匹配范围内的主用凭据`);
    await fetchData();
  } catch (e: any) {
    message.error(e?.message || "设置失败");
  }
};

const remove = async (rec: Credential) => {
  try {
    await deleteCredential(rec.id);
    message.success("已删除");
    await fetchData();
  } catch (e: any) {
    message.error(e?.message || "删除失败");
  }
};

const testOne = async (rec: Credential) => {
  testingId.value = rec.id;
  try {
    const result = await testCredential(rec.id);
    if (result.ok) {
      message.success(
        `连通成功 (${result.latencyMs}ms${result.modelsCount ? `, 可见 ${result.modelsCount} 个模型` : ""})`
      );
    } else {
      message.error(`失败：${result.error || `HTTP ${result.status}`}`);
    }
  } catch (e: any) {
    message.error(e?.message || "测试失败");
  } finally {
    testingId.value = null;
  }
};

onMounted(fetchData);
</script>
