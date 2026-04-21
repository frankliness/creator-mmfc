<template>
  <div>
    <a-space wrap style="margin-bottom: 16px">
      <a-select v-model:value="category" placeholder="分类" allow-clear style="width: 160px">
        <a-select-option value="auth">认证</a-select-option>
        <a-select-option value="project">项目</a-select-option>
        <a-select-option value="storyboard">分镜</a-select-option>
        <a-select-option value="task">任务</a-select-option>
        <a-select-option value="canvas_project">画布项目</a-select-option>
        <a-select-option value="canvas_asset">画布素材</a-select-option>
        <a-select-option value="canvas_ai">画布 AI</a-select-option>
      </a-select>
      <a-select v-model:value="targetType" placeholder="目标类型" allow-clear style="width: 160px">
        <a-select-option value="User">User</a-select-option>
        <a-select-option value="Project">Project</a-select-option>
        <a-select-option value="Storyboard">Storyboard</a-select-option>
        <a-select-option value="GenerationTask">GenerationTask</a-select-option>
        <a-select-option value="CanvasProject">CanvasProject</a-select-option>
        <a-select-option value="CanvasAsset">CanvasAsset</a-select-option>
      </a-select>
      <a-input v-model:value="action" placeholder="操作名" allow-clear style="width: 180px" />
      <a-input v-model:value="search" placeholder="ID/路由关键词" allow-clear style="width: 220px" />
      <a-button type="primary" @click="handleSearch">查询</a-button>
    </a-space>

    <a-table
      :columns="columns"
      :data-source="data"
      :loading="loading"
      :pagination="pagination"
      @change="handleTableChange"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          {{ record.metadata?.status || "-" }}
        </template>
        <template v-else-if="column.key === 'errorSummary'">
          {{ record.metadata?.error || "-" }}
        </template>
        <template v-if="column.key === 'metadata'">
          <a-popover title="详情" trigger="click">
            <template #content>
              <pre style="max-width: 520px; max-height: 360px; overflow: auto; font-size: 11px">{{ JSON.stringify(record.metadata, null, 2) }}</pre>
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
import { getUserActionLogs } from "@/api/user-action-logs";

const data = ref([]);
const loading = ref(false);
const category = ref<string>();
const targetType = ref<string>();
const action = ref("");
const search = ref("");
const pagination = ref({ current: 1, pageSize: 20, total: 0, showSizeChanger: true });

const columns = [
  { title: "用户", dataIndex: ["user", "email"], width: 180, ellipsis: true },
  { title: "分类", dataIndex: "category", width: 120 },
  { title: "操作", dataIndex: "action", width: 240, ellipsis: true },
  { title: "目标类型", dataIndex: "targetType", width: 140 },
  { title: "目标 ID", dataIndex: "targetId", width: 220, ellipsis: true },
  { title: "项目 ID", dataIndex: "projectId", width: 220, ellipsis: true },
  { title: "任务 ID", dataIndex: "taskId", width: 220, ellipsis: true },
  { title: "路由", dataIndex: "route", width: 220, ellipsis: true },
  { title: "状态", key: "status", width: 100 },
  { title: "错误摘要", key: "errorSummary", width: 260, ellipsis: true },
  { title: "详情", key: "metadata", width: 80 },
  { title: "时间", dataIndex: "createdAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
];

async function fetchData() {
  loading.value = true;
  try {
    const res: any = await getUserActionLogs({
      page: pagination.value.current,
      size: pagination.value.pageSize,
      category: category.value || undefined,
      targetType: targetType.value || undefined,
      action: action.value || undefined,
      search: search.value || undefined,
    });
    data.value = res.data;
    pagination.value.total = res.pagination.total;
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
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
