<template>
  <div>
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="默认模型（按用途）"
      description="给每个用途选一个默认模型；未在画布前端选模型时使用。运行时凭据由模型的 providers 顺序 + 主用凭据自动决定，无需在此选 provider。"
    />

    <a-tabs v-model:activeKey="activePurpose" type="card">
      <a-tab-pane v-for="p in PURPOSES" :key="p.key" :tab="p.label">
        <a-card :title="`${p.label} 默认模型`" size="small" style="margin-top: 12px">
          <a-form layout="vertical">
            <a-form-item label="默认模型">
              <a-select
                v-model:value="forms[p.key].modelKey"
                allow-clear
                placeholder="选择此用途下已注册并启用的模型"
                style="max-width: 480px"
              >
                <a-select-option
                  v-for="m in modelsByCategory[p.key] || []"
                  :key="m.modelKey"
                  :value="m.modelKey"
                >
                  {{ m.label }} ({{ (m.providers || []).join(", ") }})
                </a-select-option>
              </a-select>
              <div v-if="!modelsByCategory[p.key]?.length" style="color: #faad14; margin-top: 6px">
                此用途下还没启用任何模型。请先到「模型注册表」启用至少一个。
              </div>
            </a-form-item>

            <a-form-item v-if="forms[p.key].modelKey">
              <template #label>
                <span>预解析（仅供查看）</span>
              </template>
              <div v-if="resolvePreview(p.key)" style="font-family: monospace; font-size: 13px">
                <div>支持 provider：<a-tag v-for="pv in resolvePreview(p.key)!.providers" :key="pv">{{ pv }}</a-tag></div>
                <div>实际凭据：
                  <a-tag v-if="resolvePreview(p.key)!.matchedCredential" color="green">
                    {{ resolvePreview(p.key)!.matchedCredential!.name }}
                    ({{ resolvePreview(p.key)!.matchedCredential!.provider }})
                  </a-tag>
                  <a-tag v-else color="red">无可用凭据</a-tag>
                </div>
              </div>
            </a-form-item>

            <a-button
              v-if="canWrite"
              type="primary"
              :loading="saving === p.key"
              @click="save(p.key)"
            >
              保存默认模型
            </a-button>
            <a-tag v-else color="default">
              无 defaults 写权限（同时需要 globalConfig.write）
            </a-tag>
          </a-form>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { listModels, type ModelEntry, type ModelCategory } from "@/api/model-registry";
import { useUserStore } from "@/store/user";

const userStore = useUserStore();
// 保存默认模型实际会触发 globalConfig 写操作，两个权限同时要求
const canWrite = computed(() =>
  userStore.canWrite("defaults") && userStore.canWrite("globalConfig"),
);
import { listCredentials, type Credential } from "@/api/credentials";
import { updateGlobalConfig } from "@/api/global-config";

type Purpose = "chat" | "canvas_image" | "canvas_image_edit" | "storyboard";

const PURPOSES: { key: Purpose; label: string }[] = [
  { key: "chat", label: "画布聊天" },
  { key: "canvas_image", label: "画布文生图" },
  { key: "canvas_image_edit", label: "画布图生图" },
  { key: "storyboard", label: "分镜生成" },
];

const activePurpose = ref<Purpose>("chat");

const forms = reactive<Record<Purpose, { modelKey: string | null }>>({
  chat: { modelKey: null },
  canvas_image: { modelKey: null },
  canvas_image_edit: { modelKey: null },
  storyboard: { modelKey: null },
});

const allModels = ref<ModelEntry[]>([]);
const credentials = ref<Credential[]>([]);
const saving = ref<Purpose | null>(null);

const modelsByCategory = computed<Record<Purpose, ModelEntry[]>>(() => {
  const out: Record<Purpose, ModelEntry[]> = {
    chat: [],
    canvas_image: [],
    canvas_image_edit: [],
    storyboard: [],
  };
  for (const m of allModels.value) {
    if (!m.isActive) continue;
    const c = m.category as Purpose;
    if (out[c]) out[c].push(m);
  }
  return out;
});

const resolvePreview = (purpose: Purpose) => {
  const modelKey = forms[purpose].modelKey;
  if (!modelKey) return null;
  const model = (modelsByCategory.value[purpose] || []).find((m) => m.modelKey === modelKey);
  if (!model) return null;
  const supported = model.providers || [];

  // 模拟后端 pickCredentialForModel：按 providers 顺序找 isPrimary，再任意 active
  let matched: Credential | null = null;
  for (const p of supported) {
    const c = credentials.value.find((x) => x.provider === p && x.isPrimary && x.isActive);
    if (c) { matched = c; break; }
  }
  if (!matched) {
    matched = credentials.value.find((x) => supported.includes(x.provider) && x.isActive) ?? null;
  }

  return { providers: supported, matchedCredential: matched };
};

const KEY_OF: Record<Purpose, string> = {
  chat: "chat_default_model_key",
  canvas_image: "canvas_image_default_model_key",
  canvas_image_edit: "canvas_image_edit_default_model_key",
  storyboard: "storyboard_default_model_key",
};

const save = async (purpose: Purpose) => {
  const modelKey = forms[purpose].modelKey;
  if (!modelKey) {
    message.warning("请先选择模型");
    return;
  }
  saving.value = purpose;
  try {
    await updateGlobalConfig(KEY_OF[purpose], { value: modelKey, encrypted: false });
    message.success(`${PURPOSES.find((p) => p.key === purpose)?.label} 默认模型已保存`);
  } catch (e: any) {
    message.error(e?.message || "保存失败");
  } finally {
    saving.value = null;
  }
};

interface GlobalConfigRow {
  key: string;
  value: string;
}

const loadDefaults = async () => {
  // 直接拿 global-configs 列表读已有的 default_model_key
  const list: GlobalConfigRow[] = await import("@/api/global-config").then((m) => m.getGlobalConfigs());
  for (const p of PURPOSES) {
    const row = list.find((x) => x.key === KEY_OF[p.key]);
    forms[p.key].modelKey = row?.value || null;
  }
};

onMounted(async () => {
  try {
    [allModels.value, credentials.value] = await Promise.all([
      listModels(),
      listCredentials(),
    ]);
    await loadDefaults();
  } catch (e: any) {
    message.error(e?.message || "加载失败");
  }
});
</script>
