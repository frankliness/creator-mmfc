<template>
  <div v-if="user">
    <a-page-header :title="user.name" :sub-title="user.email" @back="$router.back()">
      <template #extra>
        <a-space>
          <a-popconfirm title="确认重置密码？" @confirm="handleResetPassword">
            <a-button danger>重置密码</a-button>
          </a-popconfirm>
          <a-select v-model:value="user.status" style="width: 120px" @change="handleStatusChange">
            <a-select-option value="ACTIVE">活跃</a-select-option>
            <a-select-option value="SUSPENDED">暂停</a-select-option>
            <a-select-option value="DISABLED">禁用</a-select-option>
          </a-select>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs default-active-key="info">
      <a-tab-pane key="info" tab="基本信息">
        <a-descriptions bordered :column="2">
          <a-descriptions-item label="ID">{{ user.id }}</a-descriptions-item>
          <a-descriptions-item label="邮箱">{{ user.email }}</a-descriptions-item>
          <a-descriptions-item label="名称">{{ user.name }}</a-descriptions-item>
          <a-descriptions-item label="状态"><a-tag :color="user.status === 'ACTIVE' ? 'green' : 'red'">{{ user.status }}</a-tag></a-descriptions-item>
          <a-descriptions-item label="Token 总消耗">{{ user.totalTokens }}</a-descriptions-item>
          <a-descriptions-item label="注册时间">{{ new Date(user.createdAt).toLocaleString() }}</a-descriptions-item>
          <a-descriptions-item label="备注" :span="2">
            <a-textarea v-model:value="remark" :rows="2" />
            <a-button type="primary" size="small" @click="handleUpdateRemark" style="margin-top: 8px">保存备注</a-button>
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="api-config" tab="API 配置">
        <a-button type="primary" @click="showConfigModal = true" style="margin-bottom: 16px">新增配置</a-button>
        <a-table :columns="configColumns" :data-source="configs" row-key="id" size="small">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'action'">
              <a-popconfirm title="确认删除？" @confirm="handleDeleteConfig(record.id)">
                <a-button type="link" danger size="small">删除</a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>

        <a-modal v-model:open="showConfigModal" title="新增 API 配置" @ok="handleCreateConfig">
          <a-form layout="vertical">
            <a-form-item label="Provider"><a-select v-model:value="configForm.provider">
              <a-select-option value="seedance">Seedance</a-select-option>
              <a-select-option value="gemini">Gemini</a-select-option>
              <a-select-option value="openai">OpenAI</a-select-option>
              <a-select-option value="claude">Claude</a-select-option>
            </a-select></a-form-item>
            <a-form-item label="名称"><a-input v-model:value="configForm.name" /></a-form-item>
            <a-form-item label="Endpoint"><a-input v-model:value="configForm.endpoint" /></a-form-item>
            <a-form-item label="API Key"><a-input-password v-model:value="configForm.apiKey" /></a-form-item>
            <a-form-item label="模型"><a-input v-model:value="configForm.model" /></a-form-item>
            <a-form-item><a-checkbox v-model:checked="configForm.isDefault">设为默认</a-checkbox></a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <a-tab-pane key="token" tab="Token 消耗">
        <a-descriptions bordered :column="1" size="small" style="max-width: 520px">
          <a-descriptions-item label="全站 TokenUsageLog 合计">{{ user.totalTokens }}</a-descriptions-item>
          <a-descriptions-item label="画布 CanvasAiCall Token 合计">{{ user.canvasTokenTotal ?? "0" }}</a-descriptions-item>
          <a-descriptions-item label="画布 AI 调用次数">{{ user.canvasCallCount ?? 0 }}</a-descriptions-item>
          <a-descriptions-item label="画布项目数">{{ user._count?.canvasProjects ?? 0 }}</a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="canvas-quota" tab="AI 画布配额">
        <p style="color: #666; margin-bottom: 12px">
          对应用户端校验字段：<code>quota.daily_image_limit</code>（每日生图次数上限）、
          <code>quota.daily_chat_tokens</code>（每日聊天 totalTokens 上限）。留空表示不限制。
        </p>
        <a-form layout="vertical" style="max-width: 400px">
          <a-form-item label="每日生图次数上限">
            <a-input-number v-model:value="canvasQuotaForm.daily_image_limit" :min="0" style="width: 100%" placeholder="不限制请留空" />
          </a-form-item>
          <a-form-item label="每日聊天 Token 上限">
            <a-input-number v-model:value="canvasQuotaForm.daily_chat_tokens" :min="0" style="width: 100%" placeholder="不限制请留空" />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" @click="saveCanvasQuota">保存配额</a-button>
          </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import { getUser, updateUser, resetPassword, getUserApiConfigs, createApiConfig, deleteApiConfig } from "@/api/users";

const route = useRoute();
const userId = route.params.id as string;
const user = ref<any>(null);
const remark = ref("");
const configs = ref<any[]>([]);
const showConfigModal = ref(false);
const configForm = reactive({ provider: "seedance", name: "", endpoint: "", apiKey: "", model: "", isDefault: false });

const canvasQuotaForm = reactive<{ daily_image_limit: number | null; daily_chat_tokens: number | null }>({
  daily_image_limit: null,
  daily_chat_tokens: null,
});

const configColumns = [
  { title: "Provider", dataIndex: "provider" },
  { title: "名称", dataIndex: "name" },
  { title: "Endpoint", dataIndex: "endpoint" },
  { title: "API Key", dataIndex: "apiKey" },
  { title: "默认", dataIndex: "isDefault", customRender: ({ text }: any) => text ? "是" : "否" },
  { title: "操作", key: "action", width: 80 },
];

async function fetchUser() {
  user.value = await getUser(userId);
  remark.value = user.value.remark || "";
  const q = user.value.quota || {};
  canvasQuotaForm.daily_image_limit =
    typeof q.daily_image_limit === "number" && Number.isFinite(q.daily_image_limit) ? q.daily_image_limit : null;
  canvasQuotaForm.daily_chat_tokens =
    typeof q.daily_chat_tokens === "number" && Number.isFinite(q.daily_chat_tokens) ? q.daily_chat_tokens : null;
}

async function saveCanvasQuota() {
  const merged: Record<string, unknown> = { ...(user.value?.quota || {}) };
  if (canvasQuotaForm.daily_image_limit != null) {
    merged.daily_image_limit = Number(canvasQuotaForm.daily_image_limit);
  } else {
    delete merged.daily_image_limit;
  }
  if (canvasQuotaForm.daily_chat_tokens != null) {
    merged.daily_chat_tokens = Number(canvasQuotaForm.daily_chat_tokens);
  } else {
    delete merged.daily_chat_tokens;
  }
  await updateUser(userId, { quota: merged });
  message.success("画布配额已保存");
  await fetchUser();
}
async function fetchConfigs() { configs.value = (await getUserApiConfigs(userId)) as any; }

async function handleStatusChange(status: string) {
  await updateUser(userId, { status });
  message.success("状态已更新");
}
async function handleUpdateRemark() {
  await updateUser(userId, { remark: remark.value });
  message.success("备注已保存");
}
async function handleResetPassword() {
  const res: any = await resetPassword(userId);
  message.success(`密码已重置为: ${res.tempPassword}`);
}
async function handleCreateConfig() {
  await createApiConfig(userId, configForm);
  message.success("配置已创建");
  showConfigModal.value = false;
  fetchConfigs();
}
async function handleDeleteConfig(configId: string) {
  await deleteApiConfig(userId, configId);
  message.success("配置已删除");
  fetchConfigs();
}

onMounted(() => { fetchUser(); fetchConfigs(); });
</script>
