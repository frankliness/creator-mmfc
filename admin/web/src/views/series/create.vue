<template>
  <div style="max-width: 1000px">
    <a-page-header title="新建 Series" @back="$router.back()" />
    <a-form layout="vertical" :model="form" @finish="onSubmit">
      <a-card title="基础信息" style="margin-bottom: 16px">
        <a-form-item label="项目名称" name="name" required>
          <a-input v-model:value="form.name" placeholder="例如：Dark Fantasy Short Drama" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" :rows="3" />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="6">
            <a-form-item label="集数" required>
              <a-input-number v-model:value="form.totalEpisodes" :min="1" :max="200" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="默认比例">
              <a-select v-model:value="form.defaultRatio">
                <a-select-option value="9:16">9:16</a-select-option>
                <a-select-option value="16:9">16:9</a-select-option>
                <a-select-option value="1:1">1:1</a-select-option>
                <a-select-option value="3:4">3:4</a-select-option>
                <a-select-option value="4:3">4:3</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="默认分辨率">
              <a-select v-model:value="form.defaultResolution">
                <a-select-option value="480p">480p</a-select-option>
                <a-select-option value="720p">720p</a-select-option>
                <a-select-option value="1080p">1080p</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="默认风格">
              <a-input v-model:value="form.defaultStyle" placeholder="例如：电影感" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-card>

      <a-card title="成员（导演 + 制作者）" style="margin-bottom: 16px">
        <a-form-item label="导演 / Series Owner" required>
          <a-select
            v-model:value="form.ownerId"
            placeholder="选择导演"
            show-search
            option-filter-prop="label"
            :options="userOptions"
            @change="onOwnerChange"
          />
          <div style="color: #52c41a; font-size: 12px; margin-top: 4px">
            ✓ 导演将自动成为 Series Owner（拥有集数锁定、buffer 调配等管理权限）
          </div>
        </a-form-item>
        <a-form-item label="制作者">
          <a-select
            v-model:value="producerIds"
            mode="multiple"
            placeholder="选择制作者（多个）"
            show-search
            option-filter-prop="label"
            :options="userOptions"
          />
        </a-form-item>
      </a-card>

      <a-card title="资源预算" style="margin-bottom: 16px">
        <p style="color: #999">至少配置一条 Seedance Token 预算和一条 Canvas 成功次数预算。</p>
        <a-table
          :data-source="form.resourceBudgets"
          :columns="budgetColumns"
          :pagination="false"
          row-key="key"
          size="small"
        >
          <template #bodyCell="{ column, record, index }">
            <template v-if="column.dataIndex === 'provider'">
              <a-input v-model:value="record.provider" placeholder="seedance / azure_openai" size="small" />
            </template>
            <template v-if="column.dataIndex === 'modelKey'">
              <a-input v-model:value="record.modelKey" placeholder="模型 key" size="small" />
            </template>
            <template v-if="column.dataIndex === 'budgetScope'">
              <a-select v-model:value="record.budgetScope" size="small" style="width: 100%">
                <a-select-option value="video_generation">video_generation</a-select-option>
                <a-select-option value="canvas_image_generation">canvas_image_generation</a-select-option>
              </a-select>
            </template>
            <template v-if="column.dataIndex === 'metricType'">
              <a-select v-model:value="record.metricType" size="small" style="width: 100%">
                <a-select-option value="TOKEN">TOKEN</a-select-option>
                <a-select-option value="SUCCESS_COUNT">SUCCESS_COUNT</a-select-option>
              </a-select>
            </template>
            <template v-if="column.dataIndex === 'totalBudget'">
              <a-input-number v-model:value="record.totalBudget" :min="0" size="small" style="width: 100%" />
            </template>
            <template v-if="column.dataIndex === 'buffer'">
              <a-input-number v-model:value="record.buffer" :min="0" size="small" style="width: 100%" />
            </template>
            <template v-if="column.dataIndex === 'allocationMode'">
              <a-select v-model:value="record.allocationMode" size="small" style="width: 100%">
                <a-select-option value="NONE">不分配</a-select-option>
                <a-select-option value="AVERAGE">平均分配</a-select-option>
                <a-select-option value="BUFFER_THEN_AVERAGE">扣 buffer 后平均</a-select-option>
              </a-select>
            </template>
            <template v-if="column.key === 'op'">
              <a-button type="link" danger size="small" @click="removeBudget(index)">删除</a-button>
            </template>
          </template>
        </a-table>
        <a-space style="margin-top: 12px">
          <a-button @click="addBudget('seedance', 'video_generation', 'TOKEN', '*')">+ Seedance Token（全局）</a-button>
          <a-button @click="addBudget('canvas', 'canvas_image_generation', 'SUCCESS_COUNT', '*')">+ Canvas 成功次数（全局）</a-button>
        </a-space>
        <div style="margin-top: 8px; color: rgba(0,0,0,.45); font-size: 12px">
          ✓ ModelKey 填 <code>*</code> 表示该 provider 所有模型共享同一额度（推荐）；如需按具体模型独立计费，可填具体 modelKey
        </div>
      </a-card>

      <a-affix :offset-bottom="10">
        <a-card>
          <a-space>
            <a-button type="primary" html-type="submit" :loading="submitting">提交</a-button>
            <a-button @click="$router.back()">取消</a-button>
          </a-space>
        </a-card>
      </a-affix>
    </a-form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { getUsers } from "@/api/users";
import { createSeries } from "@/api/series";
import { message } from "ant-design-vue";

const router = useRouter();
const submitting = ref(false);
const userOptions = ref<{ value: string; label: string }[]>([]);

const form = ref({
  name: "",
  description: "",
  ownerId: undefined as string | undefined,
  totalEpisodes: 12,
  defaultRatio: "9:16",
  defaultResolution: "720p",
  defaultStyle: "",
  resourceBudgets: [] as Array<{
    key: string;
    provider: string;
    modelKey: string;
    budgetScope: string;
    metricType: "TOKEN" | "SUCCESS_COUNT";
    totalBudget: number;
    buffer: number;
    allocationMode: "NONE" | "AVERAGE" | "BUFFER_THEN_AVERAGE";
  }>,
});

const producerIds = ref<string[]>([]);

const budgetColumns = [
  { title: "Provider", dataIndex: "provider", width: 140 },
  { title: "ModelKey", dataIndex: "modelKey", width: 180 },
  { title: "Scope", dataIndex: "budgetScope", width: 180 },
  { title: "Metric", dataIndex: "metricType", width: 130 },
  { title: "总预算", dataIndex: "totalBudget", width: 140 },
  { title: "Buffer", dataIndex: "buffer", width: 120 },
  { title: "分配模式", dataIndex: "allocationMode", width: 170 },
  { title: "操作", key: "op", width: 70 },
];

function onOwnerChange(uid: string) {
  // ownerId 自动加入 members（OWNER 角色）
  if (uid && producerIds.value.includes(uid)) {
    producerIds.value = producerIds.value.filter((p) => p !== uid);
  }
}

function addBudget(provider: string, scope: string, metric: "TOKEN" | "SUCCESS_COUNT", modelKey = "") {
  form.value.resourceBudgets.push({
    key: `${Date.now()}-${Math.random()}`,
    provider,
    modelKey,
    budgetScope: scope,
    metricType: metric,
    totalBudget: 0,
    buffer: 0,
    allocationMode: metric === "TOKEN" ? "BUFFER_THEN_AVERAGE" : "NONE",
  });
}

function removeBudget(index: number) {
  form.value.resourceBudgets.splice(index, 1);
}

async function onSubmit() {
  if (!form.value.name) return message.warning("项目名称必填");
  if (!form.value.ownerId) return message.warning("请指定导演");
  if (form.value.resourceBudgets.length === 0) {
    if (!confirm("没有配置任何预算，确定继续吗？")) return;
  }
  const emptyKey = form.value.resourceBudgets.find((b) => !b.modelKey?.trim());
  if (emptyKey) {
    return message.warning(`请填写 ModelKey（provider=${emptyKey.provider}，例如 seedance-v1）`);
  }
  submitting.value = true;
  try {
    const members = [
      { userId: form.value.ownerId!, role: "OWNER" as const },
      ...producerIds.value.map((u) => ({ userId: u, role: "PRODUCER" as const })),
    ];
    const payload = {
      name: form.value.name,
      description: form.value.description || null,
      ownerId: form.value.ownerId!,
      totalEpisodes: form.value.totalEpisodes,
      defaultRatio: form.value.defaultRatio,
      defaultResolution: form.value.defaultResolution,
      defaultStyle: form.value.defaultStyle,
      members,
      resourceBudgets: form.value.resourceBudgets.map((b) => ({
        provider: b.provider,
        modelKey: b.modelKey,
        budgetScope: b.budgetScope,
        metricType: b.metricType,
        totalBudget: String(b.totalBudget),
        buffer: String(b.buffer ?? 0),
        allocationMode: b.allocationMode === "NONE" ? undefined : b.allocationMode,
      })),
    };
    const res: any = await createSeries(payload);
    message.success("创建成功");
    router.replace(`/series/${res.id}`);
  } catch (e: any) {
    message.error(e?.response?.data?.error || "创建失败");
  } finally {
    submitting.value = false;
  }
}

async function loadUsers() {
  try {
    const res: any = await getUsers({ page: 1, size: 500 });
    userOptions.value = (res.data ?? []).map((u: any) => ({
      value: u.id,
      label: `${u.name || u.email} (${u.email})`,
    }));
  } catch (e) {
    message.error("加载用户列表失败，请刷新重试");
  }
}

onMounted(loadUsers);
</script>
