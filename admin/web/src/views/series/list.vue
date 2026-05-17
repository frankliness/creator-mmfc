<template>
  <div>
    <a-space style="margin-bottom: 16px" wrap>
      <a-input-search
        v-model:value="search"
        placeholder="搜索 Series 名称"
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
        <a-select-option value="LOCKED">LOCKED</a-select-option>
        <a-select-option value="OVER_BUDGET">OVER_BUDGET</a-select-option>
        <a-select-option value="ARCHIVED">ARCHIVED</a-select-option>
      </a-select>
      <a-button
        v-if="canWrite"
        type="primary"
        @click="$router.push('/series/new')"
      >
        新建 Series
      </a-button>
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
        <template v-if="column.key === 'owner'">
          <span v-if="record.owner">
            {{ record.owner.name ? `${record.owner.name} (${record.owner.email})` : record.owner.email }}
          </span>
          <span v-else style="color: #999">—</span>
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'counts'">
          集数 {{ record.episodeCount ?? 0 }} · 成员 {{ record.memberCount ?? 0 }}
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="$router.push(`/series/${record.id}`)">
            详情
          </a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { listSeries } from "@/api/series";
import { useUserStore } from "@/store/user";

const userStore = useUserStore();
const canWrite = computed(() => userStore.canWrite("series"));

const data = ref<any[]>([]);
const loading = ref(false);
const search = ref("");
const statusFilter = ref<string | undefined>(undefined);
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "名称", dataIndex: "name", ellipsis: true },
  { title: "导演 / Owner", key: "owner", width: 200 },
  { title: "状态", key: "status", width: 130 },
  { title: "规模", key: "counts", width: 160 },
  { title: "创建时间", dataIndex: "createdAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "操作", key: "action", width: 90 },
];

function statusColor(s: string) {
  const m: Record<string, string> = {
    ACTIVE: "green",
    LOCKED: "orange",
    OVER_BUDGET: "red",
    ARCHIVED: "default",
  };
  return m[s] || "default";
}

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await listSeries({
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
