<template>
  <div>
    <a-input-search v-model:value="search" placeholder="搜索项目名称" @search="fetchData" style="width: 300px; margin-bottom: 16px" allow-clear />
    <a-table :columns="columns" :data-source="data" :loading="loading" :pagination="pagination" @change="handleTableChange" row-key="id">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'user'">{{ record.user?.email }}</template>
        <template v-if="column.key === 'tokenTotal'">{{ Number(record.tokenSummary?.totalTokens || 0).toLocaleString() }}</template>
        <template v-if="column.key === 'tokenModels'">
          <a-popover v-if="record.tokenSummary?.byModel?.length" title="模型拆分" trigger="click">
            <template #content>
              <a-table
                :columns="tokenModelColumns"
                :data-source="record.tokenSummary.byModel"
                :pagination="false"
                size="small"
                :row-key="(r: any) => `${r.provider}-${r.model}`"
                style="width: 420px"
              />
            </template>
            <a-button type="link" size="small">查看</a-button>
          </a-popover>
          <span v-else>-</span>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="$router.push(`/projects/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getProjects } from "@/api/projects";

const data = ref([]);
const loading = ref(false);
const search = ref("");
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "项目名称", dataIndex: "name" },
  { title: "用户", key: "user" },
  { title: "状态", key: "status" },
  { title: "模式", dataIndex: "creationMode" },
  { title: "分镜数", dataIndex: ["_count", "storyboards"] },
  { title: "总 Token", key: "tokenTotal", width: 140 },
  { title: "模型拆分", key: "tokenModels", width: 100 },
  { title: "创建时间", dataIndex: "createdAt", customRender: ({ text }: any) => new Date(text).toLocaleDateString() },
  { title: "操作", key: "action", width: 80 },
];

const tokenModelColumns = [
  { title: "Provider", dataIndex: "provider", width: 110 },
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "Token", dataIndex: "total", width: 110, customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "次数", dataIndex: "count", width: 80 },
];

function statusColor(s: string) {
  const map: Record<string, string> = { COMPLETED: "green", FAILED: "red", REVIEW: "blue", GENERATING_VIDEOS: "orange", DRAFT: "default" };
  return map[s] || "default";
}

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getProjects({ page: pagination.value.current, size: pagination.value.pageSize, search: search.value || undefined });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally { loading.value = false; }
}

function handleTableChange(pag: any) {
  pagination.value.current = pag.current;
  fetchData();
}

onMounted(fetchData);
</script>
