<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="AI 画布并发配置"
      description="这些配置由用户端 Worker 读取，GlobalConfig 有约 1 分钟缓存；修改后无需重新发版，但可能需要等待下一轮缓存刷新。"
    />
    <a-card size="small" title="画布生图调度" style="margin-bottom: 16px; max-width: 900px">
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
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item>
              <template #label>
                单用户全局占比上限（%）
                <a-tooltip title="单个用户最多占用 globalLimit × pct% 个槽位，防止一人独占全局。例如 global=15, pct=40 → 单人最多 6/15。">
                  <span style="color: #999; cursor: help">ⓘ</span>
                </a-tooltip>
              </template>
              <a-input-number v-model:value="concurrencyForm.userSharePct" :min="1" :max="100" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item>
              <template #label>
                僵尸回收宽限（分钟）
                <a-tooltip title="任务 RUNNING 超过 timeout + 此宽限后，sweeper 兜底判 FAILED 并释放槽位。默认 5min。">
                  <span style="color: #999; cursor: help">ⓘ</span>
                </a-tooltip>
              </template>
              <a-input-number v-model:value="concurrencyForm.zombieGraceMinutes" :min="1" :max="60" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="启用多渠道轮询">
          <a-switch v-model:checked="concurrencyForm.rotationEnabled" />
          <span style="color: #999; font-size: 12px; margin-left: 8px">
            开启后画布生图任务会按各 ProviderCredential 的并发上限轮询分发，命中 429 自动冷却该渠道；关闭则回退到 v1.4 单凭据策略。
          </span>
        </a-form-item>
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
const CANVAS_IMAGE_USER_SHARE_CAP_PCT_KEY = "canvas_image_user_share_cap_pct";
const CANVAS_IMAGE_ZOMBIE_GRACE_MS_KEY = "canvas_image_zombie_grace_ms";
const CANVAS_IMAGE_ROTATION_ENABLED_KEY = "canvas_image_rotation_enabled";

// 与 web/src/lib/canvas/concurrency-config.ts 中的默认值保持一致。
const DEFAULT_GLOBAL = 15;
const DEFAULT_USER = 3;
const DEFAULT_TIMEOUT_MIN = 30;
const DEFAULT_USER_SHARE_PCT = 40;
const DEFAULT_ZOMBIE_GRACE_MIN = 5;

const configs = ref<any[]>([]);
const loading = ref(false);
const showEdit = ref(false);
const editKey = ref("");
const editValue = ref("");
const editEncrypted = ref(false);
const editRemark = ref("");
const savingConcurrency = ref(false);
const concurrencyForm = reactive({
  global: DEFAULT_GLOBAL,
  defaultUser: DEFAULT_USER,
  timeoutMinutes: DEFAULT_TIMEOUT_MIN,
  userSharePct: DEFAULT_USER_SHARE_PCT,
  zombieGraceMinutes: DEFAULT_ZOMBIE_GRACE_MIN,
  rotationEnabled: true,
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
  concurrencyForm.global = readConfigNumber(CANVAS_IMAGE_GLOBAL_CONCURRENCY_KEY, DEFAULT_GLOBAL);
  concurrencyForm.defaultUser = readConfigNumber(CANVAS_IMAGE_DEFAULT_USER_CONCURRENCY_KEY, DEFAULT_USER);
  concurrencyForm.timeoutMinutes = Math.max(
    1,
    Math.round(
      readConfigNumber(CANVAS_IMAGE_TASK_TIMEOUT_MS_KEY, DEFAULT_TIMEOUT_MIN * 60000) / 60000
    )
  );
  concurrencyForm.userSharePct = readConfigNumber(
    CANVAS_IMAGE_USER_SHARE_CAP_PCT_KEY,
    DEFAULT_USER_SHARE_PCT
  );
  concurrencyForm.zombieGraceMinutes = Math.max(
    1,
    Math.round(
      readConfigNumber(CANVAS_IMAGE_ZOMBIE_GRACE_MS_KEY, DEFAULT_ZOMBIE_GRACE_MIN * 60000) / 60000
    )
  );
  const rotationRaw = configs.value.find((item) => item.key === CANVAS_IMAGE_ROTATION_ENABLED_KEY)?.value;
  if (rotationRaw === undefined || rotationRaw === null || rotationRaw === "") {
    concurrencyForm.rotationEnabled = true;
  } else {
    const s = String(rotationRaw).toLowerCase();
    concurrencyForm.rotationEnabled = !(s === "false" || s === "0" || s === "off" || s === "no");
  }
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
  if (
    !concurrencyForm.global ||
    !concurrencyForm.defaultUser ||
    !concurrencyForm.timeoutMinutes ||
    !concurrencyForm.userSharePct ||
    !concurrencyForm.zombieGraceMinutes
  ) {
    message.warning("并发、超时、占比、宽限配置必须大于 0");
    return;
  }
  if (concurrencyForm.userSharePct < 1 || concurrencyForm.userSharePct > 100) {
    message.warning("单用户全局占比上限必须在 1-100 之间");
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
      updateGlobalConfig(CANVAS_IMAGE_USER_SHARE_CAP_PCT_KEY, {
        value: String(concurrencyForm.userSharePct),
        encrypted: false,
        remark: "AI 画布单用户最多占用的全局并发百分比（1-100）",
      }),
      updateGlobalConfig(CANVAS_IMAGE_ZOMBIE_GRACE_MS_KEY, {
        value: String(Math.round(concurrencyForm.zombieGraceMinutes * 60000)),
        encrypted: false,
        remark: "任务 RUNNING 超过 timeout 后再宽限多久判 FAILED（毫秒）",
      }),
      updateGlobalConfig(CANVAS_IMAGE_ROTATION_ENABLED_KEY, {
        value: concurrencyForm.rotationEnabled ? "true" : "false",
        encrypted: false,
        remark: "AI 画布生图多渠道轮询总开关；关闭后回退到 v1.4 单凭据策略",
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
