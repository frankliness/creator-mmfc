<template>
  <div v-if="task">
    <a-page-header :title="`任务: ${task.arkTaskId}`" @back="$router.back()">
      <template #extra><a-tag :color="task.status === 'SUCCEEDED' || task.status === 'PERSISTED' ? 'green' : task.status === 'FAILED' ? 'red' : 'blue'">{{ task.status }}</a-tag></template>
    </a-page-header>

    <a-descriptions bordered :column="2" style="margin-bottom: 16px">
      <a-descriptions-item label="任务 ID">{{ task.id }}</a-descriptions-item>
      <a-descriptions-item label="Ark 任务 ID">{{ task.arkTaskId }}</a-descriptions-item>
      <a-descriptions-item label="模型">{{ task.model }}</a-descriptions-item>
      <a-descriptions-item label="Ark 状态">{{ task.arkStatus }}</a-descriptions-item>
      <a-descriptions-item label="分辨率">{{ task.resolution }}</a-descriptions-item>
      <a-descriptions-item label="比例">{{ task.ratio }}</a-descriptions-item>
      <a-descriptions-item label="时长">{{ task.duration }}s</a-descriptions-item>
      <a-descriptions-item label="Seed">{{ task.seed }}</a-descriptions-item>
      <a-descriptions-item label="Completion Tokens">{{ task.completionTokens }}</a-descriptions-item>
      <a-descriptions-item label="Total Tokens">{{ task.totalTokens }}</a-descriptions-item>
      <a-descriptions-item label="用户">{{ task.storyboard?.project?.user?.email }}</a-descriptions-item>
      <a-descriptions-item label="项目">
        <a-button type="link" @click="$router.push(`/projects/${task.storyboard?.project?.id}`)">{{ task.storyboard?.project?.name }}</a-button>
      </a-descriptions-item>
      <a-descriptions-item label="API 配置" v-if="task.apiConfig">{{ task.apiConfig.name }} ({{ task.apiConfig.provider }})</a-descriptions-item>
      <a-descriptions-item label="错误信息" v-if="task.error" :span="2"><a-alert :message="task.error" type="error" /></a-descriptions-item>
    </a-descriptions>

    <a-card v-if="task.videoUrl || task.localVideoPath" title="视频预览" size="small">
      <video :src="task.videoUrl" controls style="max-width: 100%; max-height: 400px" />
    </a-card>

    <a-card title="关联分镜 Prompt" size="small" style="margin-top: 16px">
      <pre style="white-space: pre-wrap; font-size: 12px; background: #f5f5f5; padding: 12px; border-radius: 4px">{{ task.storyboard?.prompt }}</pre>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { getTask } from "@/api/tasks";

const route = useRoute();
const task = ref<any>(null);

onMounted(async () => { task.value = await getTask(route.params.id as string); });
</script>
