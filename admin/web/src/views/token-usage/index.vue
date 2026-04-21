<template>
  <div>
    <a-tabs v-model:activeKey="activeTab" @change="onTabChange">
      <a-tab-pane key="all" tab="全站 Token（TokenUsageLog）">
        <a-space wrap style="margin-bottom: 16px">
          <a-select v-model:value="range" style="width: 180px" @change="handleRangeChange">
            <a-select-option value="today">今日（北京时间）</a-select-option>
            <a-select-option value="7">近 7 天</a-select-option>
            <a-select-option value="30">近 30 天</a-select-option>
            <a-select-option value="90">近 90 天</a-select-option>
          </a-select>
          <a-range-picker
            v-model:value="dateRange"
            value-format="YYYY-MM-DD"
            style="width: 260px"
            @change="fetchAll"
          />
          <a-input v-model:value="filters.userEmail" placeholder="用户邮箱" allow-clear style="width: 180px" />
          <a-input v-model:value="filters.projectId" placeholder="项目 ID" allow-clear style="width: 180px" />
          <a-input v-model:value="filters.provider" placeholder="Provider" allow-clear style="width: 140px" />
          <a-input v-model:value="filters.model" placeholder="模型" allow-clear style="width: 180px" />
          <a-button type="primary" @click="fetchAll">查询</a-button>
          <a-button @click="resetFilters">重置</a-button>
        </a-space>

        <a-row :gutter="16" style="margin-bottom: 16px">
          <a-col :span="16">
            <a-card title="Token 消耗趋势" size="small">
              <div ref="trendChart" style="height: 300px"></div>
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card title="Provider 分布" size="small">
              <div ref="providerChart" style="height: 300px"></div>
            </a-card>
          </a-col>
        </a-row>

        <a-card title="用户模型消耗 Top 50" size="small">
          <a-table
            :columns="userColumns"
            :data-source="userRanking"
            :row-key="(r: any) => `${r.userId}-${r.provider}-${r.model}`"
            size="small"
            :pagination="false"
          />
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="canvas" tab="AI 画布（CanvasAiCall）">
        <a-space wrap style="margin-bottom: 16px">
          <a-select v-model:value="canvasRange" style="width: 180px" @change="handleCanvasRangeChange">
            <a-select-option value="today">今日（北京时间）</a-select-option>
            <a-select-option value="7">近 7 天</a-select-option>
            <a-select-option value="30">近 30 天</a-select-option>
            <a-select-option value="90">近 90 天</a-select-option>
          </a-select>
          <a-range-picker
            v-model:value="canvasDateRange"
            value-format="YYYY-MM-DD"
            style="width: 260px"
            @change="fetchCanvas"
          />
          <a-button type="primary" @click="fetchCanvas">查询</a-button>
          <a-button @click="resetCanvasFilters">重置</a-button>
        </a-space>
        <a-row :gutter="16">
          <a-col :span="8">
            <a-card title="按用户" size="small">
              <a-table :columns="canvasUserColumns" :data-source="canvasByUser" row-key="userId" size="small" :pagination="false" />
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card title="按画布项目" size="small">
              <a-table
                :columns="canvasProjColumns"
                :data-source="canvasByProject"
                :row-key="(r: any) => `${r.projectId ?? 'null'}-${r.userEmail}`"
                size="small"
                :pagination="false"
              />
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card title="按模型" size="small">
              <a-table :columns="canvasModelColumns" :data-source="canvasByModel" row-key="model" size="small" :pagination="false" />
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import dayjs from "dayjs";
import { getSummary, getByUser, getByProvider, getCanvasByUser, getCanvasByProject, getCanvasByModel } from "@/api/token-usage";
import * as echarts from "echarts";

const activeTab = ref("all");
const range = ref("30");
const canvasRange = ref("30");
const dateRange = ref<string[]>([]);
const canvasDateRange = ref<string[]>([]);
const filters = ref({
  userEmail: "",
  projectId: "",
  provider: "",
  model: "",
});
const trendChart = ref<HTMLElement>();
const providerChart = ref<HTMLElement>();
const userRanking = ref<any[]>([]);
const canvasByUser = ref<any[]>([]);
const canvasByProject = ref<any[]>([]);
const canvasByModel = ref<any[]>([]);

const userColumns = [
  { title: "排名", customRender: ({ index }: any) => index + 1, width: 60 },
  { title: "邮箱", dataIndex: "email" },
  { title: "名称", dataIndex: "name" },
  { title: "Provider", dataIndex: "provider", width: 120 },
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "总 Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "请求次数", dataIndex: "count" },
];

const canvasUserColumns = [
  { title: "邮箱", dataIndex: "email", ellipsis: true },
  { title: "名称", dataIndex: "name", ellipsis: true },
  { title: "Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "次数", dataIndex: "count" },
];

const canvasProjColumns = [
  { title: "项目", dataIndex: "projectName", ellipsis: true },
  { title: "用户", dataIndex: "userEmail", width: 120, ellipsis: true },
  { title: "Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "次数", dataIndex: "count" },
];

const canvasModelColumns = [
  { title: "模型", dataIndex: "model", ellipsis: true },
  { title: "Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "次数", dataIndex: "count" },
];

function buildRangeParams(value: string) {
  return value === "today" ? { range: "today" } : { days: Number(value) };
}

function buildDateRangeParams(dateValue: string[]) {
  if (!Array.isArray(dateValue) || dateValue.length !== 2 || !dateValue[0] || !dateValue[1]) {
    return undefined;
  }

  return {
    from: dayjs(dateValue[0]).startOf("day").toISOString(),
    to: dayjs(dateValue[1]).add(1, "day").startOf("day").toISOString(),
  };
}

function buildTokenParams() {
  return {
    ...(buildDateRangeParams(dateRange.value) ?? buildRangeParams(range.value)),
    ...(filters.value.userEmail ? { userEmail: filters.value.userEmail.trim() } : {}),
    ...(filters.value.projectId ? { projectId: filters.value.projectId.trim() } : {}),
    ...(filters.value.provider ? { provider: filters.value.provider.trim() } : {}),
    ...(filters.value.model ? { model: filters.value.model.trim() } : {}),
  };
}

async function fetchAll() {
  const params = buildTokenParams();
  const [summaryRes, providerRes, userRes] = await Promise.all([
    getSummary({ ...params, period: "day" }),
    getByProvider(params),
    getByUser(params),
  ]);

  userRanking.value = (userRes as any[]).slice(0, 50);

  await nextTick();
  if (trendChart.value) {
    const chart = echarts.getInstanceByDom(trendChart.value) || echarts.init(trendChart.value);
    const items = summaryRes as any[];
    const dates = [...new Set(items.map((t: any) => t.periodKey?.split("T")[0]))];
    chart.setOption({
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: dates },
      yAxis: { type: "value" },
      series: [{ data: dates.map((d) => items.filter((t: any) => t.periodKey?.startsWith(d)).reduce((sum: number, t: any) => sum + Number(t.total || 0), 0)), type: "bar" }],
    });
  }

  if (providerChart.value) {
    const chart = echarts.getInstanceByDom(providerChart.value) || echarts.init(providerChart.value);
    chart.setOption({
      tooltip: { trigger: "item" },
      series: [{ type: "pie", radius: ["40%", "70%"], data: (providerRes as any[]).map((p: any) => ({ name: `${p.provider}/${p.model}`, value: Number(p.total) })) }],
    });
  }
}

async function fetchCanvas() {
  const params = buildDateRangeParams(canvasDateRange.value) ?? buildRangeParams(canvasRange.value);
  const [u, p, m] = await Promise.all([
    getCanvasByUser(params),
    getCanvasByProject(params),
    getCanvasByModel(params),
  ]);
  canvasByUser.value = u as any[];
  canvasByProject.value = (p as any[]).slice(0, 30);
  canvasByModel.value = m as any[];
}

function resetFilters() {
  range.value = "30";
  dateRange.value = [];
  filters.value = {
    userEmail: "",
    projectId: "",
    provider: "",
    model: "",
  };
  fetchAll();
}

function resetCanvasFilters() {
  canvasRange.value = "30";
  canvasDateRange.value = [];
  fetchCanvas();
}

function handleRangeChange() {
  dateRange.value = [];
  fetchAll();
}

function handleCanvasRangeChange() {
  canvasDateRange.value = [];
  fetchCanvas();
}

function onTabChange(key: string) {
  if (key === "canvas") fetchCanvas();
}

onMounted(() => {
  fetchAll();
});
</script>
