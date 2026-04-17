<template>
  <div v-if="template">
    <a-page-header :title="template.name" :sub-title="`v${template.version} · ${template.category}`" @back="$router.back()">
      <template #extra>
        <a-space>
          <a-button @click="handlePublish" type="primary">发布</a-button>
          <a-button @click="handleSave">保存</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row :gutter="16">
      <a-col :span="16">
        <a-card title="内容编辑" size="small">
          <a-textarea v-model:value="content" :rows="25" style="font-family: monospace; font-size: 13px" />
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card title="版本历史" size="small">
          <a-input v-model:value="changeNote" placeholder="变更说明" style="margin-bottom: 8px" />
          <a-timeline>
            <a-timeline-item v-for="v in versions" :key="v.id">
              <a-space>
                <strong>v{{ v.version }}</strong>
                <span style="color: #999">{{ new Date(v.createdAt).toLocaleString() }}</span>
              </a-space>
              <p v-if="v.changeNote" style="margin: 4px 0 0; color: #666; font-size: 12px">{{ v.changeNote }}</p>
              <a-button type="link" size="small" @click="handleRollback(v.version)">回滚到此版本</a-button>
            </a-timeline-item>
          </a-timeline>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { getPrompt, updatePrompt, publishPrompt, rollbackPrompt, getPromptVersions } from "@/api/prompts";

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;
const template = ref<any>(null);
const content = ref("");
const changeNote = ref("");
const versions = ref<any[]>([]);

async function fetchData() {
  template.value = await getPrompt(id);
  content.value = template.value.content;
  versions.value = template.value.versions || [];
}

async function handleSave() {
  await updatePrompt(id, { content: content.value, changeNote: changeNote.value || undefined });
  message.success("已保存");
  changeNote.value = "";
  fetchData();
}

async function handlePublish() {
  await publishPrompt(id);
  message.success("已发布");
}

async function handleRollback(version: number) {
  await rollbackPrompt(id, version);
  message.success(`已回滚到 v${version}`);
  fetchData();
}

onMounted(fetchData);
</script>
