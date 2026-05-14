<template>
  <div class="admin-permission-matrix">
    <div v-if="role === 'SUPER_ADMIN'" style="margin-bottom: 12px">
      <a-alert
        type="info"
        show-icon
        message="超级管理员默认拥有全部权限"
        description="无需在此分配权限。"
      />
    </div>

    <div v-else style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
      <a-space>
        <a-tag color="default">分栏数：{{ ADMIN_SECTIONS.length }}</a-tag>
        <a-tag color="blue">已可读：{{ readCount }}</a-tag>
        <a-tag color="orange">已可写：{{ writeCount }}</a-tag>
      </a-space>
      <a-space v-if="!readonly">
        <a-button size="small" @click="applyAllReadOnly">一键只读全部</a-button>
        <a-button size="small" danger @click="clearAll">一键清空</a-button>
      </a-space>
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      size="small"
      bordered
      :row-class-name="rowClassName"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'group'">
          <a-tag :color="record.group === 'system' ? 'purple' : 'geekblue'">
            {{ record.group === "system" ? "系统设置" : "主菜单" }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'label'">
          <div>
            <strong>{{ record.label }}</strong>
            <div style="color: rgba(0,0,0,.45); font-size: 12px; margin-top: 2px">
              {{ record.description }}
            </div>
            <div v-if="record.writeDescription" style="color: rgba(0,0,0,.45); font-size: 12px; margin-top: 2px">
              写：{{ record.writeDescription }}
            </div>
            <div v-if="record.note" style="color: #ad4e00; font-size: 12px; margin-top: 2px">
              注：{{ record.note }}
            </div>
          </div>
        </template>
        <template v-else-if="column.key === 'read'">
          <a-switch
            :checked="isRead(record.key)"
            :disabled="readonly || role === 'SUPER_ADMIN'"
            @change="(v: boolean) => onReadChange(record.key, v)"
          />
        </template>
        <template v-else-if="column.key === 'write'">
          <template v-if="!record.hasWrite">
            <a-tag color="default">只读模块</a-tag>
          </template>
          <a-switch
            v-else
            :checked="isWrite(record.key)"
            :disabled="readonly || role === 'SUPER_ADMIN'"
            @change="(v: boolean) => onWriteChange(record.key, v)"
          />
        </template>
        <template v-else-if="column.key === 'risk'">
          <a-tag v-if="record.highRiskWrite" color="red">高危写权限</a-tag>
          <a-tag v-else color="green">常规</a-tag>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  ADMIN_SECTIONS,
  normalizePermissions,
  type PermissionMatrix,
  type SectionKey,
} from "@/config/admin-sections";

type AdminRole = "SUPER_ADMIN" | "ADMIN" | "OPERATOR";

const props = withDefaults(
  defineProps<{
    modelValue: PermissionMatrix;
    role: AdminRole;
    readonly?: boolean;
  }>(),
  { readonly: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: PermissionMatrix): void;
}>();

// 视图态副本：以 normalize 后的 modelValue 为权威；任何变更都重新 normalize 再 emit
const current = computed<PermissionMatrix>(() => normalizePermissions(props.modelValue ?? {}));

const rows = computed(() => ADMIN_SECTIONS);

const columns = [
  { title: "分组", key: "group", width: 100 },
  { title: "分栏", key: "label" },
  { title: "可读 / read", key: "read", width: 110 },
  { title: "可写 / write", key: "write", width: 110 },
  { title: "风险等级", key: "risk", width: 110 },
];

function isRead(key: SectionKey): boolean {
  if (props.role === "SUPER_ADMIN") return true;
  return !!current.value[key]?.read;
}

function isWrite(key: SectionKey): boolean {
  if (props.role === "SUPER_ADMIN") return true;
  return !!current.value[key]?.write;
}

function emitNormalized(next: PermissionMatrix) {
  emit("update:modelValue", normalizePermissions(next));
}

function onReadChange(key: SectionKey, value: boolean) {
  const next: PermissionMatrix = { ...current.value };
  if (!value) {
    // read 关 → write 自动关，等同删除该 key
    delete next[key];
  } else {
    next[key] = { read: true, write: next[key]?.write ?? false };
  }
  emitNormalized(next);
}

function onWriteChange(key: SectionKey, value: boolean) {
  const next: PermissionMatrix = { ...current.value };
  if (value) {
    // write 开 → 自动开 read
    next[key] = { read: true, write: true };
  } else {
    next[key] = { read: true, write: false };
  }
  emitNormalized(next);
}

function applyAllReadOnly() {
  const next: PermissionMatrix = {};
  for (const s of ADMIN_SECTIONS) {
    next[s.key] = { read: true, write: false };
  }
  emitNormalized(next);
}

function clearAll() {
  emitNormalized({});
}

const readCount = computed(() =>
  ADMIN_SECTIONS.filter((s) => current.value[s.key]?.read).length,
);
const writeCount = computed(() =>
  ADMIN_SECTIONS.filter((s) => current.value[s.key]?.write).length,
);

function rowClassName(record: { highRiskWrite?: boolean }) {
  return record.highRiskWrite ? "permission-row-risk" : "";
}
</script>

<style scoped>
.admin-permission-matrix :deep(.permission-row-risk) {
  background-color: #fffaf0;
}
</style>
