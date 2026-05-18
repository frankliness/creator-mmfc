<template>
  <div>
    <a-page-header :title="data?.name || '加载中...'" @back="$router.back()">
      <template #extra>
        <a-tag :color="statusColor(data?.status)">{{ data?.status }}</a-tag>
      </template>
      <a-descriptions size="small" :column="3">
        <a-descriptions-item label="ID">{{ data?.id }}</a-descriptions-item>
        <a-descriptions-item label="导演">
          <a-space>
            <span v-if="data?.owner">
              {{ data.owner.name ? `${data.owner.name} (${data.owner.email})` : data.owner.email }}
            </span>
            <span v-else>—</span>
            <a-button v-if="canWrite" type="link" size="small" @click="openChangeOwner">更换</a-button>
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">{{ data ? new Date(data.createdAt).toLocaleString() : "—" }}</a-descriptions-item>
      </a-descriptions>
    </a-page-header>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="overview" tab="概览">
        <a-card style="margin-bottom: 16px">
          <a-form layout="vertical">
            <a-form-item label="Series 名称">
              <a-input v-model:value="editName" />
            </a-form-item>
            <a-form-item label="描述">
              <a-textarea v-model:value="editDesc" :rows="3" />
            </a-form-item>
            <a-button type="primary" @click="onSaveBasicInfo">保存修改</a-button>
          </a-form>
        </a-card>
        <a-card>
          <a-descriptions :column="2">
            <a-descriptions-item label="项目名称">{{ data?.name }}</a-descriptions-item>
            <a-descriptions-item label="状态">{{ data?.status }}</a-descriptions-item>
            <a-descriptions-item label="集数">{{ data?.projects?.length ?? 0 }}</a-descriptions-item>
            <a-descriptions-item label="成员">{{ data?.members?.length ?? 0 }}</a-descriptions-item>
            <a-descriptions-item label="描述" :span="2">{{ data?.description || "—" }}</a-descriptions-item>
          </a-descriptions>
          <a-divider />
          <a-space v-if="canWrite">
            <a-button @click="onChangeStatus('ACTIVE')">激活</a-button>
            <a-button @click="onChangeStatus('LOCKED')">锁定</a-button>
            <a-button danger @click="onChangeStatus('ARCHIVED')">归档</a-button>
          </a-space>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="members" tab="成员">
        <a-card>
          <a-space style="margin-bottom: 12px" v-if="canWrite">
            <a-select
              v-model:value="addUserId"
              show-search
              option-filter-prop="label"
              placeholder="选择用户"
              :options="userOptions"
              style="width: 280px"
            />
            <a-select v-model:value="addRole" style="width: 130px">
              <a-select-option value="OWNER">OWNER</a-select-option>
              <a-select-option value="PRODUCER">PRODUCER</a-select-option>
              <a-select-option value="VIEWER">VIEWER</a-select-option>
            </a-select>
            <a-button type="primary" @click="onAddMember">添加成员</a-button>
          </a-space>
          <a-table :data-source="data?.members ?? []" :columns="memberColumns" row-key="id" size="small">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'user'">
                <span v-if="record.user">
                  {{ record.user.name ? `${record.user.name} (${record.user.email})` : record.user.email }}
                </span>
                <span v-else style="color: #999">{{ record.userId }}</span>
              </template>
              <template v-if="column.key === 'role'">
                <a-select
                  v-if="canWrite"
                  :value="record.role"
                  size="small"
                  style="width: 110px"
                  @change="(v: string) => onChangeRole(record.id, v)"
                >
                  <a-select-option value="OWNER">OWNER</a-select-option>
                  <a-select-option value="PRODUCER">PRODUCER</a-select-option>
                  <a-select-option value="VIEWER">VIEWER</a-select-option>
                </a-select>
                <a-tag v-else>{{ record.role }}</a-tag>
              </template>
              <template v-if="column.key === 'op'">
                <a-popconfirm v-if="canWrite" title="确认移除？" @confirm="onRemoveMember(record.id)">
                  <a-button type="link" danger size="small">移除</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="budgets" tab="预算">
        <a-card>
          <a-table :data-source="data?.budgets ?? []" :columns="budgetColumns" row-key="id" size="small" :pagination="false">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'progress'">
                <div style="min-width: 220px">
                  <a-progress
                    :percent="Number((Number(record.committedUsage) / Math.max(1, Number(record.totalBudget))) * 100).toFixed(1) as any"
                    :stroke-color="Number(record.committedUsage) >= Number(record.totalBudget) ? '#ff4d4f' : '#1677ff'"
                    size="small"
                  />
                  <span style="font-size: 12px; color: #666">
                    已用 {{ record.committedUsage }} / 预扣 {{ record.reservedUsage }} / 总 {{ record.totalBudget }} (buffer {{ record.unallocatedBudget }})
                  </span>
                </div>
              </template>
              <template v-if="column.key === 'op'">
                <a-button v-if="canWrite" type="link" size="small" @click="openAdjust(record)">调整</a-button>
              </template>
            </template>
          </a-table>

          <!-- 展开集数分配 -->
          <template v-if="tokenBudgetsWithAllocations.length > 0">
            <a-divider />
            <div style="font-weight: 600; margin-bottom: 8px">展开集数分配</div>
            <div v-for="budget in tokenBudgetsWithAllocations" :key="budget.id" style="margin-bottom: 16px">
              <div style="font-size: 13px; font-weight: 500; margin-bottom: 4px">
                {{ budget.provider }} · {{ budget.modelKey }} ({{ budget.budgetScope }})
              </div>
              <a-table
                :data-source="episodeAllocRows(budget)"
                :columns="allocSubColumns"
                row-key="projectId"
                size="small"
                :pagination="false"
              >
                <template #bodyCell="{ column, record: allocRec }">
                  <template v-if="column.key === 'allocProgress'">
                    <a-progress
                      :percent="Number((Number(allocRec.committedUsage) / Math.max(1, Number(allocRec.allocatedBudget))) * 100).toFixed(1) as any"
                      :stroke-color="progressColor(Number(allocRec.committedUsage), Number(allocRec.allocatedBudget))"
                      size="small"
                    />
                  </template>
                </template>
              </a-table>
            </div>
          </template>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="episodes" tab="集数">
        <a-card>
          <a-space v-if="canWrite" style="margin-bottom: 12px">
            <a-button v-if="tokenBudgets.length > 0" @click="openDistributeModal">均分 Buffer</a-button>
            <a-button type="primary" @click="openAssignModal">分配现有项目</a-button>
          </a-space>
          <a-table :data-source="data?.projects ?? []" :columns="episodeColumns" row-key="id" size="small" :pagination="false">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'locked'">
                <a-tag v-if="record.lockedReason" color="orange">锁定</a-tag>
                <span v-else>—</span>
              </template>
              <template v-if="column.key === 'tokenUsage'">
                <div v-if="tokenBudgetsForEpisode(record.id).length > 0">
                  <div v-for="item in tokenBudgetsForEpisode(record.id)" :key="item.budgetId" style="margin-bottom: 4px">
                    <span style="font-size: 11px; color: #999">{{ item.modelKey }}</span>
                    <template v-if="item.alloc">
                      <a-progress
                        :percent="Number((Number(item.alloc.committedUsage) / Math.max(1, Number(item.alloc.allocatedBudget))) * 100).toFixed(1) as any"
                        :stroke-color="progressColor(Number(item.alloc.committedUsage), Number(item.alloc.allocatedBudget))"
                        size="small"
                      />
                      <span style="font-size: 11px; color: #666">
                        集数 {{ item.alloc.committedUsage }} / {{ item.alloc.allocatedBudget }}
                      </span>
                    </template>
                    <template v-else>
                      <a-progress
                        :percent="Number((Number(item.series.committedUsage) / Math.max(1, Number(item.series.totalBudget))) * 100).toFixed(1) as any"
                        :stroke-color="progressColor(Number(item.series.committedUsage), Number(item.series.totalBudget))"
                        size="small"
                      />
                      <span style="font-size: 11px; color: #666">
                        Series 总消耗 {{ item.series.committedUsage }} / {{ item.series.totalBudget }}（集数无单独分配）
                      </span>
                    </template>
                  </div>
                </div>
                <span v-else style="font-size: 11px; color: #999">—</span>
              </template>
              <template v-if="column.key === 'op'">
                <a-button type="link" size="small" @click="$router.push(`/projects/${record.id}`)">详情</a-button>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="logs" tab="日志">
        <a-card>
          <a-table :data-source="events" :columns="eventColumns" :loading="eventsLoading" :pagination="eventsPagination" row-key="id" size="small" @change="onEventsChange">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'amount'">
                {{ record.amount }} <a-tag size="small">{{ record.metricType }}</a-tag>
              </template>
              <template v-if="column.key === 'operator'">
                {{ record.operatorRole || "?" }} · {{ record.operatorId?.slice(0, 8) }}
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- 分配现有项目 -->
    <a-modal v-model:open="assignModalOpen" title="分配现有项目到 Series" @ok="onConfirmAssign">
      <a-form layout="vertical">
        <a-form-item label="选择项目">
          <a-select
            v-model:value="assignProjectId"
            show-search
            option-filter-prop="label"
            placeholder="搜索并选择未分配的项目"
            :options="unassignedProjects"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="集号（可选）">
          <a-input-number v-model:value="assignEpisodeNumber" :min="1" style="width: 100%" placeholder="留空则不设置集号" />
        </a-form-item>
        <a-form-item label="集数标题（可选）">
          <a-input v-model:value="assignEpisodeTitle" placeholder="留空则不设置" />
        </a-form-item>
        <a-form-item label="分配 Token 预算（可选，0 表示不分配）">
          <a-input v-model:value="assignAllocatedTokens" placeholder="例如 100000" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 均分 Buffer -->
    <a-modal v-model:open="distributeModalOpen" title="均分 Buffer 到未分配集数" @ok="onConfirmDistribute">
      <a-form layout="vertical">
        <a-form-item label="选择预算">
          <a-select v-model:value="distributeBudgetId" style="width: 100%">
            <a-select-option v-for="b in tokenBudgets" :key="b.id" :value="b.id">
              {{ b.provider }} · {{ b.modelKey }} (buffer: {{ b.unallocatedBudget }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <p style="color: #888; font-size: 13px">将把该预算剩余 buffer 均分给所有尚未分配的集数。</p>
      </a-form>
    </a-modal>

    <!-- 更换导演 -->
    <a-modal v-model:open="changeOwnerOpen" title="更换导演" @ok="onConfirmChangeOwner">
      <a-form layout="vertical">
        <a-form-item label="新导演">
          <a-select
            v-model:value="changeOwnerUserId"
            show-search
            option-filter-prop="label"
            placeholder="选择用户（也会自动成为 Series 成员并升级为 OWNER）"
            :options="userOptions"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 调整预算抽屉 -->
    <a-modal v-model:open="adjustModalOpen" title="调整总预算" @ok="onConfirmAdjust">
      <a-form layout="vertical">
        <a-form-item label="当前总预算">
          <a-input :value="adjustTarget?.totalBudget" disabled />
        </a-form-item>
        <a-form-item label="增减量（正数=增加，负数=减少）">
          <a-input-number v-model:value="adjustDelta" style="width: 100%" />
        </a-form-item>
        <a-form-item label="原因">
          <a-input v-model:value="adjustReason" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useUserStore } from "@/store/user";
import {
  getSeries, updateSeries,
  addSeriesMember, updateSeriesMember, removeSeriesMember,
  adjustResourceBudget, listBudgetEvents,
  assignProjectToSeries, distributeSeriesBudget,
} from "@/api/series";
import { getProjects } from "@/api/projects";
import { getUsers } from "@/api/users";
import { message } from "ant-design-vue";

const userStore = useUserStore();
const canWrite = computed(() => userStore.canWrite("series"));
const route = useRoute();
const seriesId = String(route.params.id);

const activeTab = ref("overview");
const data = ref<any>(null);

const editName = ref("");
const editDesc = ref("");

watch(data, (val) => {
  if (val) {
    editName.value = val.name ?? "";
    editDesc.value = val.description ?? "";
  }
});

async function onSaveBasicInfo() {
  try {
    await updateSeries(seriesId, { name: editName.value, description: editDesc.value });
    message.success("已保存");
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "保存失败");
  }
}

const memberColumns = [
  { title: "成员", key: "user" },
  { title: "角色", key: "role", width: 140 },
  { title: "加入时间", dataIndex: "createdAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "操作", key: "op", width: 90 },
];

const budgetColumns = [
  { title: "Provider", dataIndex: "provider", width: 140 },
  { title: "Model", dataIndex: "modelKey", width: 200 },
  { title: "Scope", dataIndex: "budgetScope", width: 220 },
  { title: "Metric", dataIndex: "metricType", width: 130 },
  { title: "进度", key: "progress" },
  { title: "状态", dataIndex: "status", width: 110 },
  { title: "操作", key: "op", width: 80 },
];

const episodeColumns = [
  { title: "集号", dataIndex: "episodeNumber", width: 80 },
  { title: "名称", dataIndex: "name" },
  { title: "状态", dataIndex: "status", width: 160 },
  { title: "锁定", key: "locked", width: 80 },
  { title: "分镜数", dataIndex: ["_count", "storyboards"], width: 90 },
  { title: "Token 消耗", key: "tokenUsage", width: 200 },
  { title: "操作", key: "op", width: 90 },
];

const eventColumns = [
  { title: "时间", dataIndex: "createdAt", width: 180, customRender: ({ text }: any) => new Date(text).toLocaleString() },
  { title: "类型", dataIndex: "type", width: 180 },
  { title: "数量", key: "amount", width: 130 },
  { title: "操作者", key: "operator", width: 160 },
  { title: "原因", dataIndex: "reason", ellipsis: true },
];

function statusColor(s?: string) {
  return { ACTIVE: "green", LOCKED: "orange", OVER_BUDGET: "red", ARCHIVED: "default" }[s ?? ""] || "default";
}

function progressColor(committed: number, total: number): string {
  const pct = total > 0 ? (committed / total) * 100 : 0;
  if (pct >= 95) return "#ff4d4f";
  if (pct >= 80) return "#faad14";
  return "#52c41a";
}

// TOKEN budgets that have at least one allocation
const tokenBudgetsWithAllocations = computed(() => {
  return (data.value?.budgets ?? []).filter(
    (b: any) => b.metricType === "TOKEN" && b.allocations && b.allocations.length > 0,
  );
});

const allocSubColumns = [
  { title: "集号", dataIndex: "episodeNumber", key: "episodeNumber", width: 70 },
  { title: "集数名称", dataIndex: "episodeName", key: "episodeName", ellipsis: true },
  { title: "已分配", dataIndex: "allocatedBudget", width: 120 },
  { title: "已消耗", dataIndex: "committedUsage", width: 120 },
  { title: "预扣", dataIndex: "reservedUsage", width: 100 },
  { title: "进度", key: "allocProgress", width: 180 },
];

function episodeAllocRows(budget: any): any[] {
  const projects: any[] = data.value?.projects ?? [];
  const projMap = new Map(projects.map((p: any) => [p.id, p]));
  return (budget.allocations ?? [])
    .map((a: any) => {
      const proj = projMap.get(a.projectId);
      return {
        projectId: a.projectId,
        episodeNumber: proj?.episodeNumber ?? "—",
        episodeName: proj ? (proj.episodeTitle || proj.name) : a.projectId,
        allocatedBudget: a.allocatedBudget,
        committedUsage: a.committedUsage,
        reservedUsage: a.reservedUsage,
      };
    })
    .sort((x: any, y: any) => {
      const a = typeof x.episodeNumber === "number" ? x.episodeNumber : Infinity;
      const b = typeof y.episodeNumber === "number" ? y.episodeNumber : Infinity;
      return a - b;
    });
}

function tokenBudgetsForEpisode(projectId: string): Array<{
  budgetId: string;
  modelKey: string;
  status: string;
  series: { totalBudget: string; committedUsage: string; reservedUsage: string };
  alloc: { allocatedBudget: string; committedUsage: string; reservedUsage: string } | null;
}> {
  const budgets: any[] = (data.value?.budgets ?? []).filter((b: any) => b.metricType === "TOKEN");
  return budgets.map((b: any) => ({
    budgetId: b.id,
    modelKey: b.modelKey,
    status: b.status,
    series: {
      totalBudget: b.totalBudget,
      committedUsage: b.committedUsage,
      reservedUsage: b.reservedUsage,
    },
    alloc: (b.allocations ?? []).find((a: any) => a.projectId === projectId) ?? null,
  }));
}

async function load() {
  const res: any = await getSeries(seriesId);
  data.value = res;
}

const userOptions = ref<{ value: string; label: string }[]>([]);
const addUserId = ref<string | undefined>();
const addRole = ref<"OWNER" | "PRODUCER" | "VIEWER">("PRODUCER");

async function loadUserOptions() {
  try {
    const res: any = await getUsers({ page: 1, size: 500 });
    userOptions.value = (res.data ?? []).map((u: any) => ({ value: u.id, label: `${u.name || u.email} (${u.email})` }));
  } catch (e) {
    message.error("加载用户列表失败，请刷新重试");
  }
}

async function onAddMember() {
  if (!addUserId.value) return message.warning("请选择用户");
  try {
    await addSeriesMember(seriesId, { userId: addUserId.value, role: addRole.value });
    message.success("已添加");
    addUserId.value = undefined;
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "添加失败");
  }
}

async function onChangeRole(memberId: string, role: string) {
  try {
    await updateSeriesMember(seriesId, memberId, { role: role as any });
    message.success("已更新");
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "更新失败");
  }
}

async function onRemoveMember(memberId: string) {
  try {
    await removeSeriesMember(seriesId, memberId);
    message.success("已移除");
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "移除失败");
  }
}

const changeOwnerOpen = ref(false);
const changeOwnerUserId = ref<string | undefined>();
function openChangeOwner() {
  changeOwnerUserId.value = data.value?.owner?.id ?? undefined;
  changeOwnerOpen.value = true;
}
async function onConfirmChangeOwner() {
  if (!changeOwnerUserId.value) return message.warning("请选择用户");
  if (changeOwnerUserId.value === data.value?.owner?.id) {
    changeOwnerOpen.value = false;
    return;
  }
  try {
    await updateSeries(seriesId, { ownerId: changeOwnerUserId.value });
    message.success("已更换导演");
    changeOwnerOpen.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "更换导演失败");
  }
}

async function onChangeStatus(status: "ACTIVE" | "LOCKED" | "ARCHIVED") {
  if (!confirm(`确定切换到 ${status}？`)) return;
  try {
    await updateSeries(seriesId, { status });
    message.success("已更新");
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "更新失败");
  }
}

const adjustModalOpen = ref(false);
const adjustTarget = ref<any | null>(null);
const adjustDelta = ref<number>(0);
const adjustReason = ref<string>("");
function openAdjust(b: any) {
  adjustTarget.value = b;
  adjustDelta.value = 0;
  adjustReason.value = "";
  adjustModalOpen.value = true;
}
async function onConfirmAdjust() {
  if (!adjustTarget.value || adjustDelta.value === 0) return adjustModalOpen.value = false;
  try {
    await adjustResourceBudget(seriesId, adjustTarget.value.id, { delta: String(adjustDelta.value), reason: adjustReason.value });
    message.success("已调整");
    adjustModalOpen.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "调整失败");
  }
}

const events = ref<any[]>([]);
const eventsLoading = ref(false);
const eventsPagination = ref({ current: 1, pageSize: 20, total: 0 });
async function loadEvents() {
  eventsLoading.value = true;
  try {
    const res: any = await listBudgetEvents(seriesId, {
      page: eventsPagination.value.current,
      size: eventsPagination.value.pageSize,
    });
    events.value = res.data;
    eventsPagination.value.total = res.pagination.total;
  } finally {
    eventsLoading.value = false;
  }
}
function onEventsChange(pag: any) {
  eventsPagination.value.current = pag.current;
  eventsPagination.value.pageSize = pag.pageSize;
  loadEvents();
}

// === 分配现有项目 ===
const assignModalOpen = ref(false);
const assignProjectId = ref<string | undefined>();
const assignEpisodeNumber = ref<number | undefined>();
const assignEpisodeTitle = ref<string>("");
const assignAllocatedTokens = ref<string>("");
const unassignedProjects = ref<{ value: string; label: string }[]>([]);

async function openAssignModal() {
  assignProjectId.value = undefined;
  assignEpisodeNumber.value = undefined;
  assignEpisodeTitle.value = "";
  assignAllocatedTokens.value = "";
  try {
    const res: any = await getProjects({ seriesId: "null", page: 1, size: 50 });
    unassignedProjects.value = (res.data ?? []).map((p: any) => ({
      value: p.id,
      label: `${p.name} (${p.id.slice(0, 8)}...)`,
    }));
  } catch {
    message.error("加载项目列表失败");
    return;
  }
  assignModalOpen.value = true;
}

async function onConfirmAssign() {
  if (!assignProjectId.value) return message.warning("请选择项目");
  try {
    await assignProjectToSeries(seriesId, {
      projectId: assignProjectId.value,
      episodeNumber: assignEpisodeNumber.value,
      episodeTitle: assignEpisodeTitle.value || undefined,
      allocatedTokens: assignAllocatedTokens.value || undefined,
    });
    message.success("分配成功");
    assignModalOpen.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "分配失败");
  }
}

// === 均分 Buffer ===
const distributeModalOpen = ref(false);
const distributeBudgetId = ref<string | undefined>();

const tokenBudgets = computed(() =>
  (data.value?.budgets ?? []).filter((b: any) => b.metricType === "TOKEN"),
);

function openDistributeModal() {
  distributeBudgetId.value = tokenBudgets.value[0]?.id;
  distributeModalOpen.value = true;
}

async function onConfirmDistribute() {
  if (!distributeBudgetId.value) return message.warning("请选择预算");
  try {
    const res: any = await distributeSeriesBudget(seriesId, distributeBudgetId.value);
    message.success(`已均分给 ${res.distributed} 个集数，每集 ${res.perEpisode}`);
    distributeModalOpen.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.response?.data?.error || "均分失败");
  }
}

onMounted(async () => {
  await load();
  await loadUserOptions();
  await loadEvents();
});
</script>
