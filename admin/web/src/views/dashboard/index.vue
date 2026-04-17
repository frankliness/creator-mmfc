<template>
  <div>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="用户总数" :value="overview?.users?.total ?? 0" style="background: #fafafa; padding: 16px; border-radius: 8px">
          <template #suffix><span style="font-size: 14px; color: #999"> / 今日 +{{ overview?.users?.today ?? 0 }}</span></template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic title="活跃用户 (7天)" :value="overview?.users?.active ?? 0" style="background: #fafafa; padding: 16px; border-radius: 8px" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="任务总数" :value="overview?.tasks?.total ?? 0" style="background: #fafafa; padding: 16px; border-radius: 8px">
          <template #suffix>
            <a-badge :count="overview?.tasks?.running ?? 0" :number-style="{ backgroundColor: '#52c41a' }" style="margin-left: 8px" title="运行中" />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic title="Token 总消耗" :value="overview?.tokens?.total ?? '0'" style="background: #fafafa; padding: 16px; border-radius: 8px" />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :span="16">
        <a-card title="Token 消耗趋势 (近30天)" size="small">
          <div ref="trendChart" style="height: 300px"></div>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card title="任务状态分布" size="small">
          <div ref="taskChart" style="height: 300px"></div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getOverview, getTrends, getTaskStats } from "@/api/dashboard";
import * as echarts from "echarts";

const overview = ref<any>(null);
const trendChart = ref<HTMLElement>();
const taskChart = ref<HTMLElement>();

onMounted(async () => {
  const [overviewRes, trendsRes, taskStatsRes] = await Promise.all([
    getOverview(), getTrends(30), getTaskStats(),
  ]);
  overview.value = overviewRes;

  if (trendChart.value) {
    const chart = echarts.init(trendChart.value);
    const trends = trendsRes as any[];
    const dates = [...new Set(trends.map((t: any) => t.period?.split("T")[0]))];
    chart.setOption({
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: dates },
      yAxis: { type: "value" },
      series: [{ data: dates.map((d) => {
        const items = trends.filter((t: any) => t.period?.startsWith(d));
        return items.reduce((sum: number, t: any) => sum + Number(t.total || 0), 0);
      }), type: "line", smooth: true, areaStyle: {} }],
    });
  }

  if (taskChart.value) {
    const chart = echarts.init(taskChart.value);
    const stats = taskStatsRes as any[];
    chart.setOption({
      tooltip: { trigger: "item" },
      series: [{
        type: "pie", radius: ["40%", "70%"],
        data: stats.map((s: any) => ({ name: s.status, value: s.count })),
      }],
    });
  }
});
</script>
