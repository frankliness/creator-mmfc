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
          <a-dropdown :disabled="exportLoading">
            <a-button :loading="exportLoading">导出</a-button>
            <template #overlay>
              <a-menu @click="handleExportMenuClick">
                <a-menu-item key="detail">导出明细</a-menu-item>
                <a-menu-item key="byUser">导出统计</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
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

      <a-tab-pane key="project" tab="按项目维度（Series / 集数 / 用户）">
        <a-space wrap style="margin-bottom: 16px">
          <a-select v-model:value="projRange" style="width: 180px" @change="handleProjRangeChange">
            <a-select-option value="today">今日（北京时间）</a-select-option>
            <a-select-option value="7">近 7 天</a-select-option>
            <a-select-option value="30">近 30 天</a-select-option>
            <a-select-option value="90">近 90 天</a-select-option>
          </a-select>
          <a-range-picker v-model:value="projDateRange" value-format="YYYY-MM-DD" style="width: 260px" @change="fetchProject" />
          <a-select v-model:value="selectedSeriesId" placeholder="筛选 Series（可选）" allow-clear style="width: 240px" @change="fetchProject">
            <a-select-option v-for="s in bySeriesData" :key="s.seriesId" :value="s.seriesId">
              {{ s.seriesName || s.seriesId }}
            </a-select-option>
          </a-select>
          <a-button type="primary" @click="fetchProject">查询</a-button>
          <a-button @click="resetProjFilters">重置</a-button>
          <a-button :loading="projExportLoading" @click="handleProjExport">导出</a-button>
        </a-space>

        <a-card title="① 按 Series 汇总" size="small" style="margin-bottom: 16px">
          <a-table
            :columns="seriesColumns"
            :data-source="bySeriesData"
            :row-key="(r: any) => r.seriesId ?? 'null'"
            size="small"
            :pagination="false"
            :custom-row="(record: any) => ({ onClick: () => onSelectSeries(record.seriesId), style: { cursor: 'pointer' } })"
          />
          <div style="margin-top: 8px; color: rgba(0,0,0,.45); font-size: 12px">提示：点击行筛选下方明细</div>
        </a-card>

        <a-card :title="`② 集数 × 用户 明细${selectedSeriesId ? '（已筛选）' : ''}`" size="small" style="margin-bottom: 16px">
          <a-table
            :columns="breakdownColumns"
            :data-source="seriesBreakdownData"
            :row-key="(r: any) => `${r.seriesId}-${r.projectId}-${r.userId}-${r.provider}-${r.model}`"
            size="small"
            :pagination="{ pageSize: 30 }"
          />
        </a-card>

        <a-card title="③ 全项目（含 legacy）Top 100" size="small">
          <a-table
            :columns="projColumns"
            :data-source="byProjectData"
            :row-key="(r: any) => `${r.projectId}-${r.userEmail}-${r.provider}-${r.model}`"
            size="small"
            :pagination="{ pageSize: 20 }"
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
import { h, ref, onMounted, nextTick } from "vue";
import dayjs from "dayjs";
import { message } from "ant-design-vue";
import { exportTokenUsage, exportTokenUsageByUser, exportByProject, getSummary, getByUser, getByProvider, getCanvasByUser, getCanvasByProject, getCanvasByModel, getByProject, getBySeries, getBySeriesBreakdown } from "@/api/token-usage";
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
const exportLoading = ref(false);
const userRanking = ref<any[]>([]);
const canvasByUser = ref<any[]>([]);
const canvasByProject = ref<any[]>([]);
const canvasByModel = ref<any[]>([]);
const byProjectData = ref<any[]>([]);
const bySeriesData = ref<any[]>([]);
const seriesBreakdownData = ref<any[]>([]);
const selectedSeriesId = ref<string | undefined>(undefined);
const projRange = ref("30");
const projDateRange = ref<string[]>([]);
const projExportLoading = ref(false);

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

const seriesColumns = [
  { title: "Series", dataIndex: "seriesName", ellipsis: true, customRender: ({ text, record }: any) => text || record.seriesId || '(无 Series)' },
  { title: "集数数", dataIndex: "episodeCount", width: 80 },
  { title: "用户数", dataIndex: "userCount", width: 80 },
  { title: "总 Token", dataIndex: "total", width: 120, customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "调用次数", dataIndex: "count", width: 90 },
  {
    title: "模型分布",
    dataIndex: "modelBreakdown",
    customRender: ({ text }: any) => {
      const list = Array.isArray(text) ? text : [];
      if (list.length === 0) return '—';
      const lines = list.map((m: any) =>
        `${m.provider}/${m.model}: ${Number(m.total).toLocaleString()} / ${m.count}次`
      ).join('\n');
      return h('div', { style: 'white-space: pre-line; font-size: 12px; line-height: 1.6' }, lines);
    },
  },
];

const breakdownColumns = [
  { title: "Series", dataIndex: "seriesName", ellipsis: true, customRender: ({ text, record }: any) => text || record.seriesId || '—' },
  { title: "集数/画布", key: "episode", customRender: ({ record }: any) => {
    if (record.sourceType === 'canvas') {
      const id = record.projectId ? String(record.projectId).slice(0, 8) : '';
      return `画布 · ${record.episodeName || '未命名画布'}${id ? ` · ${id}` : ''}`;
    }
    const num = record.episodeNumber ? `第${record.episodeNumber}集` : '—';
    return record.episodeName ? `${num} · ${record.episodeName}` : num;
  } },
  { title: "用户", key: "user", customRender: ({ record }: any) => record.userName ? `${record.userName} (${record.userEmail})` : record.userEmail },
  { title: "Provider", dataIndex: "provider", width: 110 },
  { title: "模型", dataIndex: "model", ellipsis: true, width: 200 },
  { title: "总 Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "调用次数", dataIndex: "count" },
];

const projColumns = [
  { title: "Series", dataIndex: "seriesName", ellipsis: true, customRender: ({ text }: any) => text || '—' },
  { title: "集数/项目", dataIndex: "projectName", ellipsis: true, customRender: ({ text, record }: any) => text || record.projectId || '—' },
  { title: "用户", key: "user", customRender: ({ record }: any) => record.userName ? `${record.userName} (${record.userEmail})` : record.userEmail },
  { title: "Provider", dataIndex: "provider", width: 110 },
  { title: "模型", dataIndex: "model", ellipsis: true, width: 200 },
  { title: "总 Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "调用次数", dataIndex: "count" },
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

function buildExportFilename(type: "detail" | "byUser") {
  const suffix = type === "detail" ? "detail" : "by-user";
  return `token-usage-${suffix}-${dayjs().format("YYYYMMDD-HHmmss")}.csv`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

async function handleExport(type: "detail" | "byUser") {
  exportLoading.value = true;
  try {
    const params = buildTokenParams();
    const blob = type === "detail" ? await exportTokenUsage(params) : await exportTokenUsageByUser(params);
    const file = blob instanceof Blob ? blob : new Blob([blob], { type: "text/csv;charset=utf-8" });
    downloadBlob(file, buildExportFilename(type));
    message.success("导出成功");
  } finally {
    exportLoading.value = false;
  }
}

function handleExportMenuClick({ key }: { key: string }) {
  if (key === "detail" || key === "byUser") {
    handleExport(key);
  }
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

async function fetchProject() {
  const baseParams: Record<string, unknown> = {
    ...(buildDateRangeParams(projDateRange.value) ?? buildRangeParams(projRange.value)),
  };
  const breakdownParams = { ...baseParams, ...(selectedSeriesId.value ? { seriesId: selectedSeriesId.value } : {}) };
  const [proj, ser, brk] = await Promise.all([
    getByProject(baseParams),
    getBySeries(baseParams),
    getBySeriesBreakdown(breakdownParams),
  ]);
  byProjectData.value = proj as any[];
  bySeriesData.value = ser as any[];
  seriesBreakdownData.value = brk as any[];
}

function onSelectSeries(seriesId: string) {
  selectedSeriesId.value = selectedSeriesId.value === seriesId ? undefined : seriesId;
  fetchProject();
}

async function handleProjExport() {
  projExportLoading.value = true;
  try {
    const params = {
      ...(buildDateRangeParams(projDateRange.value) ?? buildRangeParams(projRange.value)),
      ...(selectedSeriesId.value ? { seriesId: selectedSeriesId.value } : {}),
    };
    const blob = await exportByProject(params);
    const file = blob instanceof Blob ? blob : new Blob([blob], { type: "text/csv;charset=utf-8" });
    downloadBlob(file, `token-usage-by-project-${dayjs().format("YYYYMMDD-HHmmss")}.csv`);
    message.success("导出成功");
  } finally {
    projExportLoading.value = false;
  }
}

function resetProjFilters() {
  projRange.value = "30";
  projDateRange.value = [];
  selectedSeriesId.value = undefined;
  fetchProject();
}

function handleProjRangeChange() {
  projDateRange.value = [];
  fetchProject();
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
  if (key === "project") fetchProject();
}

onMounted(() => {
  fetchAll();
});
</script>
