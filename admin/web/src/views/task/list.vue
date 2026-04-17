<template>
  <div>
    <a-space style="margin-bottom: 16px">
      <a-input-search v-model:value="search" placeholder="搜索 arkTaskId" @search="fetchData" style="width: 250px" allow-clear />
      <a-select v-model:value="status" placeholder="状态" style="width: 140px" allow-clear @change="fetchData">
        <a-select-option v-for="s in ['SUBMITTED','RUNNING','SUCCEEDED','FAILED','PERSISTING','PERSISTED']" :key="s" :value="s">{{ s }}</a-select-option>
      </a-select>
    </a-space>

    <a-table :columns="columns" :data-source="data" :loading="loading" :pagination="pagination" @change="handleTableChange" row-key="id" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="taskStatusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'user'">{{ record.storyboard?.project?.user?.email }}</template>
        <template v-if="column.key === 'project'">{{ record.storyboard?.project?.name }}</template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small" @click="$router.push(`/tasks/${record.id}`)">详情</a-button>
            <a-button v-if="record.status === 'FAILED'" type="link" size="small" @click="handleRetry(record.id)">重试</a-button>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getTasks, retryTask } from "@/api/tasks";

const data = ref([]);
const loading = ref(false);
const search = ref("");
const status = ref<string>();
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "ArkTaskId", dataIndex: "arkTaskId", ellipsis: true, width: 200 },
  { title: "用户", key: "user" },
  { title: "项目", key: "project" },
  { title: "状态", key: "status", width: 110 },
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "Token", dataIndex: "totalTokens", width: 80 },
  { title: "创建时间", dataIndex: "createdAt", customRender: ({ text }: any) => new Date(text).toLocaleString(), width: 170 },
  { title: "操作", key: "action", width: 120 },
];

function taskStatusColor(s: string) {
  const map: Record<string, string> = { SUCCEEDED: "green", PERSISTED: "green", FAILED: "red", RUNNING: "blue", SUBMITTED: "orange", PERSISTING: "cyan" };
  return map[s] || "default";
}

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getTasks({ page: pagination.value.current, size: pagination.value.pageSize, search: search.value || undefined, status: status.value || undefined });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally { loading.value = false; }
}

function handleTableChange(pag: any) { pagination.value.current = pag.current; fetchData(); }

async function handleRetry(id: string) {
  await retryTask(id);
  message.success("任务已重新提交");
  fetchData();
}

onMounted(fetchData);
</script>
