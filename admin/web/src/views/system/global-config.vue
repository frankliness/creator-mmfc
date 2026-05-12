<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="AI 画布并发配置"
      description="这些配置由用户端 Worker 读取，GlobalConfig 有约 1 分钟缓存；修改后无需重新发版，但可能需要等待下一轮缓存刷新。"
    />
    <a-card size="small" title="画布生图调度" style="margin-bottom: 16px; max-width: 760px">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="全局生图并发">
              <a-input-number v-model:value="concurrencyForm.global" :min="1" :max="500" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="默认单用户并发">
              <a-input-number v-model:value="concurrencyForm.defaultUser" :min="1" :max="100" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="单任务超时（分钟）">
              <a-input-number v-model:value="concurrencyForm.timeoutMinutes" :min="1" :max="240" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-space>
          <a-button type="primary" :loading="savingConcurrency" @click="saveConcurrencyConfig">
            保存画布并发配置
          </a-button>
          <span style="color: #999; font-size: 12px">
            用户详情页可覆盖单个用户的生图并发上限。
          </span>
        </a-space>
      </a-form>
    </a-card>

    <a-table :columns="columns" :data-source="configs" :loading="loading" row-key="id" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'value'">
          <a-space>
            <span>{{ record.value }}</span>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
          </a-space>
        </template>
        <template v-if="column.key === 'encrypted'">
          <a-tag :color="record.encrypted ? 'orange' : 'default'">{{ record.encrypted ? '加密' : '明文' }}</a-tag>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="showEdit" :title="`编辑: ${editKey}`" @ok="handleUpdate">
      <a-form layout="vertical">
        <a-form-item label="值">
          <a-input v-model:value="editValue" :type="editEncrypted ? 'password' : 'text'" />
        </a-form-item>
        <a-form-item><a-checkbox v-model:checked="editEncrypted">加密存储</a-checkbox></a-form-item>
        <a-form-item label="备注"><a-input v-model:value="editRemark" /></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getGlobalConfigs, updateGlobalConfig } from "@/api/global-config";

const CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY = "canvas_image_global_concurrency";
const CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY = "canvas_image_default_user_concurrency";
const CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY = "canvas_image_task_timeout_ms";

const configs = ref<any[]>([]);
const loading = ref(false);
const showEdit = ref(false);
const editKey = ref("");
const editValue = ref("");
const editEncrypted = ref(false);
const editRemark = ref("");
const savingConcurrency = ref(false);
const concurrencyForm = reactive({
  global: 2,
  defaultUser: 5,
  timeoutMinutes: 10,
});

const columns = [
  { title: "Key", dataIndex: "key" },
  { title: "Value", key: "value" },
  { title: "存储方式", key: "encrypted" },
  { title: "备注", dataIndex: "remark" },
];

async function fetchData() {
  loading.value = true;
  try {
    configs.value = (await getGlobalConfigs()) as any;
    syncConcurrencyForm();
  } finally { loading.value = false; }
}

function readConfigNumber(key: string, fallback: number) {
  const raw = configs.value.find((item) => item.key === key)?.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function syncConcurrencyForm() {
  concurrencyForm.global = readConfigNumber(CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY, 2);
  concurrencyForm.defaultUser = readConfigNumber(CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY, 5);
  concurrencyForm.timeoutMinutes = Math.max(
    1,
    Math.round(readConfigNumber(CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY, 600000) / 60000)
  );
}

function openEdit(record: any) {
  editKey.value = record.key;
  editValue.value = "";
  editEncrypted.value = record.encrypted;
  editRemark.value = record.remark || "";
  showEdit.value = true;
}

async function handleUpdate() {
  await updateGlobalConfig(editKey.value, { value: editValue.value, encrypted: editEncrypted.value, remark: editRemark.value });
  message.success("配置已更新");
  showEdit.value = false;
  fetchData();
}

async function saveConcurrencyConfig() {
  if (!concurrencyForm.global || !concurrencyForm.defaultUser || !concurrencyForm.timeoutMinutes) {
    message.warning("并发和超时配置必须大于 0");
    return;
  }
  savingConcurrency.value = true;
  try {
    await Promise.all([
      updateGlobalConfig(CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY, {
        value: String(concurrencyForm.global),
        encrypted: false,
        remark: "AI 画布生图全局并发上限",
      }),
      updateGlobalConfig(CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY, {
        value: String(concurrencyForm.defaultUser),
        encrypted: false,
        remark: "AI 画布生图默认单用户并发上限",
      }),
      updateGlobalConfig(CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY, {
        value: String(Math.round(concurrencyForm.timeoutMinutes * 60000)),
        encrypted: false,
        remark: "AI 画布单个生图任务 provider 调用超时毫秒数",
      }),
    ]);
    message.success("画布并发配置已保存");
    await fetchData();
  } finally {
    savingConcurrency.value = false;
  }
}

onMounted(fetchData);
</script>
