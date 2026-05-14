<template>
  <div v-if="template">
    <a-page-header
      :title="template.name"
      :sub-title="`v${template.version} · ${template.category}`"
      @back="$router.back()"
    >
      <template #extra>
        <a-space v-if="canWrite">
          <a-button @click="handlePublish" type="primary">发布</a-button>
          <a-button @click="handleSave">保存</a-button>
        </a-space>
        <a-tag v-else color="default">只读模式（无 prompts.write 权限）</a-tag>
      </template>
    </a-page-header>

    <a-row :gutter="16">
      <a-col :span="16">
        <a-card title="内容编辑" size="small">
          <a-textarea
            v-model:value="content"
            :rows="20"
            :disabled="!canWrite"
            style="font-family: monospace; font-size: 13px"
          />
        </a-card>

        <a-card
          v-if="template.category === 'JSON_SCHEMA'"
          title="Schema 实测"
          size="small"
          style="margin-top: 16px"
        >
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            message="测试当前编辑器中的 schema 是否能被实际调用并产生可解析的 JSON"
            description="会用 GlobalConfig.storyboard_* 配置的 provider 发一次最小请求（不会落库），返回模型实际响应。如果失败说明这个 schema 在当前 provider 下不可用，需要修改。"
          />
          <a-form layout="vertical">
            <a-form-item label="测试用样例输入（可选）">
              <a-textarea
                v-model:value="testSampleScript"
                :rows="2"
                placeholder="留空使用默认：『单镜头，10 秒，主角站在公园中央』"
              />
            </a-form-item>
            <a-form-item>
              <a-button
                v-if="canWrite"
                :loading="testingSchema"
                type="primary"
                @click="handleTestSchema"
              >
                测试 Schema
              </a-button>
              <span v-else style="color: rgba(0,0,0,.45)">无写权限，无法测试 Schema</span>
            </a-form-item>
          </a-form>
          <div v-if="schemaTestResult">
            <a-divider style="margin: 12px 0" />
            <a-descriptions size="small" :column="2" bordered>
              <a-descriptions-item label="结果">
                <a-tag :color="schemaTestResult.ok ? 'green' : 'red'">
                  {{ schemaTestResult.ok ? "通过" : "未通过" }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="耗时">
                {{ schemaTestResult.latencyMs }} ms
              </a-descriptions-item>
              <a-descriptions-item label="Provider">
                {{ schemaTestResult.providerUsed }}
              </a-descriptions-item>
              <a-descriptions-item label="Model">
                {{ schemaTestResult.modelUsed }}
              </a-descriptions-item>
              <a-descriptions-item label="Schema 校验">
                <a-tag :color="schemaTestResult.schemaValid ? 'green' : 'red'">
                  {{ schemaTestResult.schemaValid ? "顶层结构匹配" : "未匹配" }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="错误" v-if="schemaTestResult.error">
                <span style="color: #ff4d4f">{{ schemaTestResult.error }}</span>
              </a-descriptions-item>
            </a-descriptions>
            <a-collapse style="margin-top: 12px" :bordered="false">
              <a-collapse-panel key="raw" header="模型原始响应（前 2KB）">
                <pre class="schema-test-pre">{{ schemaTestResult.responseText || "(空)" }}</pre>
              </a-collapse-panel>
              <a-collapse-panel
                v-if="schemaTestResult.parsedOutput"
                key="parsed"
                header="解析后的 JSON"
              >
                <pre class="schema-test-pre">{{
                  JSON.stringify(schemaTestResult.parsedOutput, null, 2)
                }}</pre>
              </a-collapse-panel>
            </a-collapse>
          </div>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card title="适用 Provider" size="small">
          <a-select
            v-model:value="applicableProviders"
            mode="multiple"
            style="width: 100%"
            placeholder="留空 = 通用，所有 provider 都生效"
            allow-clear
            :disabled="!canWrite"
          >
            <a-select-option value="openai">OpenAI Compatible</a-select-option>
            <a-select-option value="azure_openai">Azure OpenAI</a-select-option>
            <a-select-option value="google">Google Gemini</a-select-option>
            <a-select-option value="custom">Custom</a-select-option>
          </a-select>
          <a-button
            v-if="canWrite"
            type="primary"
            ghost
            size="small"
            style="margin-top: 8px"
            @click="handleSaveProviders"
          >
            保存适用 Provider
          </a-button>
          <p style="margin: 8px 0 0; color: #888; font-size: 12px">
            为某些 provider 单独定制时把它们勾上；运行时优先匹配特定 provider 的版本，没匹配到再用『通用』版本（applicableProviders 为空）。
          </p>
        </a-card>

        <a-card title="版本历史" size="small" style="margin-top: 16px">
          <a-input v-model:value="changeNote" placeholder="变更说明" style="margin-bottom: 8px" :disabled="!canWrite" />
          <a-timeline>
            <a-timeline-item v-for="v in versions" :key="v.id">
              <a-space>
                <strong>v{{ v.version }}</strong>
                <span style="color: #999">{{ new Date(v.createdAt).toLocaleString() }}</span>
              </a-space>
              <p v-if="v.changeNote" style="margin: 4px 0 0; color: #666; font-size: 12px">
                {{ v.changeNote }}
              </p>
              <a-button
                v-if="canWrite"
                type="link"
                size="small"
                @click="handleRollback(v.version)"
              >回滚到此版本</a-button>
            </a-timeline-item>
          </a-timeline>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import { useUserStore } from "@/store/user";

const userStore = useUserStore();
const canWrite = computed(() => userStore.canWrite("prompts"));
import {
  getPrompt,
  updatePrompt,
  publishPrompt,
  rollbackPrompt,
  testSchema,
  type SchemaTestResult,
} from "@/api/prompts";

const route = useRoute();
const id = route.params.id as string;
const template = ref<any>(null);
const content = ref("");
const changeNote = ref("");
const versions = ref<any[]>([]);
const applicableProviders = ref<string[]>([]);

const testingSchema = ref(false);
const schemaTestResult = ref<SchemaTestResult | null>(null);
const testSampleScript = ref("");

async function fetchData() {
  template.value = await getPrompt(id);
  content.value = template.value.content;
  versions.value = template.value.versions || [];
  applicableProviders.value = Array.isArray(template.value.applicableProviders)
    ? template.value.applicableProviders
    : [];
}

async function handleSave() {
  await updatePrompt(id, {
    content: content.value,
    changeNote: changeNote.value || undefined,
  });
  message.success("已保存");
  changeNote.value = "";
  fetchData();
}

async function handleSaveProviders() {
  await updatePrompt(id, {
    applicableProviders: applicableProviders.value.length > 0 ? applicableProviders.value : null,
  });
  message.success("适用 Provider 已保存");
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

async function handleTestSchema() {
  // 用编辑器里的当前内容（可能未保存）做测试
  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(content.value);
  } catch (e) {
    message.error("当前内容不是合法 JSON，无法测试");
    return;
  }
  testingSchema.value = true;
  schemaTestResult.value = null;
  try {
    const res = await testSchema(
      parsedSchema,
      "storyboard",
      testSampleScript.value || undefined
    );
    schemaTestResult.value = res;
    if (res.ok) message.success(`Schema 测试通过 (${res.latencyMs}ms)`);
    else message.error(res.error || "Schema 测试未通过");
  } finally {
    testingSchema.value = false;
  }
}

onMounted(fetchData);
</script>

<style scoped>
.schema-test-pre {
  background: #f5f7fa;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
