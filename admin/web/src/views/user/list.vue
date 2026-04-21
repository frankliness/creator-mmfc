<template>
  <div>
    <a-space style="margin-bottom: 16px">
      <a-input-search v-model:value="search" placeholder="搜索邮箱/名称" @search="fetchData" style="width: 300px" allow-clear />
      <a-select v-model:value="status" placeholder="状态筛选" style="width: 150px" allow-clear @change="fetchData">
        <a-select-option value="ACTIVE">活跃</a-select-option>
        <a-select-option value="SUSPENDED">暂停</a-select-option>
        <a-select-option value="DISABLED">禁用</a-select-option>
      </a-select>
    </a-space>

    <a-table :columns="columns" :data-source="data" :loading="loading" :pagination="pagination" @change="handleTableChange" row-key="id">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="record.status === 'ACTIVE' ? 'green' : record.status === 'SUSPENDED' ? 'orange' : 'red'">
            {{ record.status }}
          </a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small" @click="$router.push(`/users/${record.id}`)">详情</a-button>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getUsers } from "@/api/users";

const data = ref([]);
const loading = ref(false);
const search = ref("");
const status = ref<string>();
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "邮箱", dataIndex: "email", key: "email" },
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "状态", key: "status" },
  { title: "项目数", dataIndex: ["_count", "projects"], key: "projects" },
  { title: "画布项目", dataIndex: ["_count", "canvasProjects"], key: "canvasProjects" },
  { title: "注册时间", dataIndex: "createdAt", key: "createdAt", customRender: ({ text }: any) => new Date(text).toLocaleDateString() },
  { title: "操作", key: "action", width: 100 },
];

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getUsers({
      page: pagination.value.current,
      size: pagination.value.pageSize,
      search: search.value || undefined,
      status: status.value || undefined,
    });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally {
    loading.value = false;
  }
}

function handleTableChange(pag: any) {
  pagination.value.current = pag.current;
  pagination.value.pageSize = pag.pageSize;
  fetchData();
}

onMounted(fetchData);
</script>
