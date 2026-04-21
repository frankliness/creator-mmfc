<template>
  <div v-if="project">
    <a-page-header :title="project.name" :sub-title="`by ${project.user?.email}`" @back="$router.back()">
      <template #extra>
        <a-tag :color="project.status === 'COMPLETED' ? 'green' : project.status === 'FAILED' ? 'red' : 'blue'">{{ project.status }}</a-tag>
      </template>
    </a-page-header>

    <a-descriptions bordered :column="2" style="margin-bottom: 16px">
      <a-descriptions-item label="ID">{{ project.id }}</a-descriptions-item>
      <a-descriptions-item label="模式">{{ project.creationMode }}</a-descriptions-item>
      <a-descriptions-item label="比例">{{ project.ratio }}</a-descriptions-item>
      <a-descriptions-item label="分辨率">{{ project.resolution }}</a-descriptions-item>
      <a-descriptions-item label="风格" :span="2">{{ project.style }}</a-descriptions-item>
    </a-descriptions>

    <a-card title="Token 统计" size="small" style="margin-bottom: 16px">
      <a-descriptions bordered :column="4" size="small">
        <a-descriptions-item label="总 Token">{{ Number(project.tokenSummary?.totalTokens || 0).toLocaleString() }}</a-descriptions-item>
        <a-descriptions-item label="输入 Token">{{ Number(project.tokenSummary?.inputTokens || 0).toLocaleString() }}</a-descriptions-item>
        <a-descriptions-item label="输出 Token">{{ Number(project.tokenSummary?.outputTokens || 0).toLocaleString() }}</a-descriptions-item>
        <a-descriptions-item label="请求次数">{{ Number(project.tokenSummary?.requestCount || 0).toLocaleString() }}</a-descriptions-item>
      </a-descriptions>
      <a-table
        style="margin-top: 12px"
        :columns="tokenColumns"
        :data-source="project.tokenSummary?.byModel || []"
        :pagination="false"
        row-key="model"
        size="small"
      />
    </a-card>

    <a-card title="分镜列表" size="small">
      <a-collapse>
        <a-collapse-panel v-for="sb in project.storyboards" :key="sb.id" :header="`${sb.storyboardId} - ${sb.status} (${sb.duration}s)`">
          <p><strong>Prompt:</strong></p>
          <pre style="white-space: pre-wrap; font-size: 12px; background: #f5f5f5; padding: 12px; border-radius: 4px">{{ sb.prompt }}</pre>
          <a-table v-if="sb.tasks?.length" :columns="taskColumns" :data-source="sb.tasks" row-key="id" size="small" :pagination="false" style="margin-top: 8px" />
        </a-collapse-panel>
      </a-collapse>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { getProject } from "@/api/projects";

const route = useRoute();
const project = ref<any>(null);

const taskColumns = [
  { title: "任务ID", dataIndex: "arkTaskId", ellipsis: true },
  { title: "状态", dataIndex: "status" },
  { title: "模型", dataIndex: "model" },
  { title: "Token", dataIndex: "totalTokens", customRender: ({ text }: any) => Number(text || 0).toLocaleString() },
];

const tokenColumns = [
  { title: "Provider", dataIndex: "provider", width: 120 },
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "Token", dataIndex: "total", width: 140, customRender: ({ text }: any) => Number(text || 0).toLocaleString() },
  { title: "次数", dataIndex: "count", width: 100 },
];

onMounted(async () => { project.value = await getProject(route.params.id as string); });
</script>
