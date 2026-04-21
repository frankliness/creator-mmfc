<template>
  <div>
    <a-space style="margin-bottom: 16px" wrap>
      <a-input-search
        v-model:value="search"
        placeholder="搜索画布名称"
        allow-clear
        style="width: 260px"
        @search="onSearch"
      />
      <a-select
        v-model:value="statusFilter"
        placeholder="状态"
        allow-clear
        style="width: 140px"
        @change="fetchData"
      >
        <a-select-option value="ACTIVE">ACTIVE</a-select-option>
        <a-select-option value="ARCHIVED">ARCHIVED</a-select-option>
        <a-select-option value="DELETED">DELETED</a-select-option>
      </a-select>
    </a-space>
    <a-table
      :columns="columns"
      :data-source="data"
      :loading="loading"
      :pagination="pagination"
      row-key="id"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'user'">{{ record.user?.email }}</template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'counts'">
          节点 {{ record._count?.nodes ?? 0 }} / 边 {{ record._count?.edges ?? 0 }} / 资产
          {{ record._count?.assets ?? 0 }} / 调用 {{ record._count?.aiCalls ?? 0 }}
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="$router.push(`/canvas-projects/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getCanvasProjects } from "@/api/canvas-projects";

const data = ref<any[]>([]);
const loading = ref(false);
const search = ref("");
const statusFilter = ref<string | undefined>(undefined);
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "名称", dataIndex: "name", ellipsis: true },
  { title: "用户", key: "user", width: 200 },
  { title: "状态", key: "status", width: 110 },
  { title: "统计", key: "counts" },
  { title: "更新时间", dataIndex: "updatedAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "操作", key: "action", width: 90 },
];

function statusColor(s: string) {
  const m: Record<string, string> = { ACTIVE: "green", ARCHIVED: "default", DELETED: "red" };
  return m[s] || "default";
}

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getCanvasProjects({
      page: pagination.value.current,
      size: pagination.value.pageSize,
      search: search.value || undefined,
      status: statusFilter.value,
    });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  pagination.value.current = 1;
  fetchData();
}

function handleTableChange(pag: any) {
  pagination.value.current = pag.current;
  pagination.value.pageSize = pag.pageSize;
  fetchData();
}

onMounted(fetchData);
</script>
