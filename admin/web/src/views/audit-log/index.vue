<template>
  <div>
    <a-space style="margin-bottom: 16px">
      <a-input v-model:value="action" placeholder="操作类型" allow-clear style="width: 200px" />
      <a-select v-model:value="targetType" placeholder="目标类型" allow-clear style="width: 160px">
        <a-select-option value="User">User</a-select-option>
        <a-select-option value="UserApiConfig">API 配置</a-select-option>
        <a-select-option value="PromptTemplate">Prompt</a-select-option>
        <a-select-option value="GlobalConfig">全局配置</a-select-option>
        <a-select-option value="AdminUser">管理员</a-select-option>
        <a-select-option value="Project">项目</a-select-option>
      </a-select>
      <a-button type="primary" @click="fetchData">查询</a-button>
    </a-space>

    <a-table :columns="columns" :data-source="data" :loading="loading" :pagination="pagination" @change="handleTableChange" row-key="id" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'changes'">
          <a-popover title="变更详情" trigger="click">
            <template #content>
              <div style="max-width: 400px">
                <p v-if="record.before"><strong>Before:</strong> <pre style="font-size: 11px">{{ JSON.stringify(record.before, null, 2) }}</pre></p>
                <p v-if="record.after"><strong>After:</strong> <pre style="font-size: 11px">{{ JSON.stringify(record.after, null, 2) }}</pre></p>
              </div>
            </template>
            <a-button type="link" size="small">查看</a-button>
          </a-popover>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getAuditLogs } from "@/api/audit-logs";

const data = ref([]);
const loading = ref(false);
const action = ref("");
const targetType = ref<string>();
const pagination = ref({ current: 1, pageSize: 20, total: 0 });

const columns = [
  { title: "管理员", dataIndex: ["admin", "displayName"] },
  { title: "操作", dataIndex: "action" },
  { title: "目标类型", dataIndex: "targetType" },
  { title: "目标 ID", dataIndex: "targetId", ellipsis: true },
  { title: "IP", dataIndex: "ip" },
  { title: "变更", key: "changes", width: 80 },
  { title: "时间", dataIndex: "createdAt", customRender: ({ text }: any) => new Date(text).toLocaleString() },
];

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getAuditLogs({ page: pagination.value.current, size: pagination.value.pageSize, action: action.value || undefined, targetType: targetType.value || undefined });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally { loading.value = false; }
}

function handleTableChange(pag: any) { pagination.value.current = pag.current; fetchData(); }

onMounted(fetchData);
</script>
