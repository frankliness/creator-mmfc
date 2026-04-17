<template>
  <div>
    <a-space style="margin-bottom: 16px">
      <a-select v-model:value="days" style="width: 150px" @change="fetchData">
        <a-select-option :value="7">近 7 天</a-select-option>
        <a-select-option :value="30">近 30 天</a-select-option>
        <a-select-option :value="90">近 90 天</a-select-option>
      </a-select>
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

    <a-card title="用户消耗排名 Top 20" size="small">
      <a-table :columns="userColumns" :data-source="userRanking" row-key="userId" size="small" :pagination="false" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getSummary, getByUser, getByProvider } from "@/api/token-usage";
import * as echarts from "echarts";

const days = ref(30);
const trendChart = ref<HTMLElement>();
const providerChart = ref<HTMLElement>();
const userRanking = ref<any[]>([]);

const userColumns = [
  { title: "排名", customRender: ({ index }: any) => index + 1, width: 60 },
  { title: "邮箱", dataIndex: "email" },
  { title: "名称", dataIndex: "name" },
  { title: "总 Token", dataIndex: "total", customRender: ({ text }: any) => Number(text).toLocaleString() },
  { title: "请求次数", dataIndex: "count" },
];

async function fetchData() {
  const [summaryRes, providerRes, userRes] = await Promise.all([
    getSummary({ days: days.value, period: "day" }),
    getByProvider({ days: days.value }),
    getByUser({ days: days.value }),
  ]);

  userRanking.value = (userRes as any[]).slice(0, 20);

  if (trendChart.value) {
    const chart = echarts.init(trendChart.value);
    const items = summaryRes as any[];
    const dates = [...new Set(items.map((t: any) => t.period?.split("T")[0]))];
    chart.setOption({
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: dates },
      yAxis: { type: "value" },
      series: [{ data: dates.map((d) => items.filter((t: any) => t.period?.startsWith(d)).reduce((sum: number, t: any) => sum + Number(t.total || 0), 0)), type: "bar" }],
    });
  }

  if (providerChart.value) {
    const chart = echarts.init(providerChart.value);
    chart.setOption({
      tooltip: { trigger: "item" },
      series: [{ type: "pie", radius: ["40%", "70%"], data: (providerRes as any[]).map((p: any) => ({ name: `${p.provider}/${p.model}`, value: Number(p.total) })) }],
    });
  }
}

onMounted(fetchData);
</script>
