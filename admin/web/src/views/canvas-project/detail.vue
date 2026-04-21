<template>
  <div v-if="row">
    <a-page-header :title="row.name" :sub-title="`用户 ${row.user?.email}`" @back="$router.back()">
      <template #extra>
        <a-tag :color="statusColor(row.status)">{{ row.status }}</a-tag>
      </template>
    </a-page-header>

    <a-descriptions bordered :column="2" style="margin-bottom: 16px">
      <a-descriptions-item label="ID">{{ row.id }}</a-descriptions-item>
      <a-descriptions-item label="用户">{{ row.user?.name }} ({{ row.user?.email }})</a-descriptions-item>
      <a-descriptions-item label="节点数">{{ row._count?.nodes ?? 0 }}</a-descriptions-item>
      <a-descriptions-item label="边数">{{ row._count?.edges ?? 0 }}</a-descriptions-item>
      <a-descriptions-item label="资产数">{{ row._count?.assets ?? 0 }}</a-descriptions-item>
      <a-descriptions-item label="AI 调用次数">{{ row._count?.aiCalls ?? 0 }}</a-descriptions-item>
      <a-descriptions-item label="画布 Token 合计" :span="2">
        {{ row.tokenSummary?.totalTokens ?? "0" }}（入 {{ row.tokenSummary?.inputTokens }} / 出 {{ row.tokenSummary?.outputTokens }}）
      </a-descriptions-item>
      <a-descriptions-item label="创建时间">{{ new Date(row.createdAt).toLocaleString() }}</a-descriptions-item>
      <a-descriptions-item label="更新时间">{{ new Date(row.updatedAt).toLocaleString() }}</a-descriptions-item>
    </a-descriptions>

    <a-card title="状态管理" size="small" style="margin-bottom: 16px">
      <a-space>
        <a-select v-model:value="statusEdit" style="width: 160px">
          <a-select-option value="ACTIVE">ACTIVE</a-select-option>
          <a-select-option value="ARCHIVED">ARCHIVED</a-select-option>
          <a-select-option value="DELETED">DELETED</a-select-option>
        </a-select>
        <a-button type="primary" @click="handlePatch">保存状态</a-button>
      </a-space>
    </a-card>

    <a-card title="最近 AI 调用" size="small" style="margin-bottom: 16px">
      <a-table
        :columns="callColumns"
        :data-source="row.recentCalls || []"
        row-key="id"
        size="small"
        :pagination="false"
      />
    </a-card>

    <a-card title="危险操作" size="small">
      <a-popconfirm title="将删除数据库记录、CanvasAiCall、相关 TokenUsageLog，并尝试删除本地图片文件。确认？" @confirm="handleDelete">
        <a-button danger>硬删除画布项目</a-button>
      </a-popconfirm>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { getCanvasProject, patchCanvasProject, deleteCanvasProject } from "@/api/canvas-projects";

const route = useRoute();
const router = useRouter();
const row = ref<any>(null);
const statusEdit = ref("ACTIVE");

const callColumns = [
  { title: "时间", dataIndex: "createdAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "类型", dataIndex: "callType", width: 140 },
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "Token", dataIndex: "totalTokens", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "状态", dataIndex: "status", width: 90 },
];

function statusColor(s: string) {
  const m: Record<string, string> = { ACTIVE: "green", ARCHIVED: "default", DELETED: "red" };
  return m[s] || "default";
}

async function load() {
  const id = route.params.id as string;
  row.value = await getCanvasProject(id);
  statusEdit.value = row.value.status;
}

async function handlePatch() {
  const id = route.params.id as string;
  await patchCanvasProject(id, { status: statusEdit.value });
  message.success("状态已更新");
  await load();
}

async function handleDelete() {
  const id = route.params.id as string;
  await deleteCanvasProject(id);
  message.success("已删除");
  router.push("/canvas-projects");
}

onMounted(load);
</script>
