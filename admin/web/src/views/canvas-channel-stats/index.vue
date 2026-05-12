<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="画布生图渠道统计"
      description="按 ProviderCredential 维度聚合，配合 /system/credentials 调整并发上限，配合 /system/global-config 切换轮询开关。RUNNING 列实时反映 worker 当前在跑的任务数。"
    />

    <a-space style="margin-bottom: 12px" align="center">
      <span>统计窗口：</span>
      <a-select v-model:value="windowMin" style="width: 140px" @change="fetchData">
        <a-select-option :value="15">最近 15 分钟</a-select-option>
        <a-select-option :value="60">最近 1 小时</a-select-option>
        <a-select-option :value="360">最近 6 小时</a-select-option>
        <a-select-option :value="1440">最近 24 小时</a-select-option>
      </a-select>
      <a-button @click="fetchData" :loading="loading">刷新</a-button>
      <span style="color: #999; font-size: 12px">页面会每 30 秒自动刷新</span>
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
        <template v-if="column.key === 'name'">
          <a-space size="small">
            <a-tag :color="providerColor(record.provider)">{{ record.provider }}</a-tag>
            <span>{{ record.name }}</span>
            <a-tag v-if="!record.isActive" color="red">已禁用</a-tag>
            <a-tag v-if="record.inCooldown" color="orange">冷却中</a-tag>
          </a-space>
        </template>
        <template v-if="column.key === 'load'">
          <a-progress
            :percent="Math.min(100, Math.round((record.currentRunning / Math.max(1, record.concurrency)) * 100))"
            :format="() => `${record.currentRunning}/${record.concurrency}`"
            size="small"
          />
        </template>
        <template v-if="column.key === 'success'">
          <a-tag color="green">{{ record.success }}</a-tag>
        </template>
        <template v-if="column.key === 'failed'">
          <a-tag v-if="record.failed > 0" color="red">{{ record.failed }}</a-tag>
          <span v-else style="color: #999">0</span>
        </template>
        <template v-if="column.key === 'rateLimited'">
          <a-tag v-if="record.rateLimited > 0" color="orange">{{ record.rateLimited }}</a-tag>
          <span v-else style="color: #999">0</span>
        </template>
        <template v-if="column.key === 'cooldownUntil'">
          <span v-if="record.cooldownUntil">{{ formatDate(record.cooldownUntil) }}</span>
          <span v-else style="color: #999">—</span>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import { listChannelStats, type ChannelStat } from "@/api/canvas-channel-stats";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "blue",
  azure_openai: "purple",
  google: "cyan",
  custom: "default",
};

const windowMin = ref(60);
const rows = ref<ChannelStat[]>([]);
const loading = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const columns = [
  { title: "渠道", key: "name" },
  { title: "并发占用", key: "load", width: 180 },
  { title: "成功", key: "success", width: 80 },
  { title: "失败", key: "failed", width: 80 },
  { title: "限流", key: "rateLimited", width: 80 },
  { title: "冷却到", key: "cooldownUntil", width: 180 },
];

const providerColor = (p: string) => PROVIDER_COLORS[p] || "default";

const formatDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString();
};

const fetchData = async () => {
  loading.value = true;
  try {
    rows.value = await listChannelStats(windowMin.value);
  } catch (e: any) {
    message.error(e?.message || "加载失败");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchData();
  timer = setInterval(fetchData, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
