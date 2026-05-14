<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center">
      <a-space>
        <a-button type="primary" @click="openCreate">新增管理员</a-button>
        <a-button @click="fetchData">刷新</a-button>
      </a-space>
      <span style="color: rgba(0,0,0,.45); font-size: 12px">
        软删除后的账号默认隐藏；如需查看，请到审计日志检索。
      </span>
    </div>

    <a-table
      :columns="columns"
      :data-source="admins"
      :loading="loading"
      row-key="id"
      :pagination="{ pageSize: 20 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'role'">
          <a-tag :color="roleColor(record.role)">{{ roleLabel(record.role) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'active'">
          <a-popconfirm
            v-if="!isSelf(record)"
            :title="record.isActive ? '确认禁用该管理员？' : '确认启用该管理员？'"
            :ok-text="record.isActive ? '禁用' : '启用'"
            cancel-text="取消"
            @confirm="handleToggle(record, !record.isActive)"
          >
            <a-switch :checked="record.isActive" />
          </a-popconfirm>
          <a-tooltip v-else title="不能禁用当前登录账号">
            <a-switch :checked="record.isActive" disabled />
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'permissionsSummary'">
          <span v-if="record.role === 'SUPER_ADMIN'" style="color: #cf1322">全部权限</span>
          <span v-else-if="summarize(record).read === 0" style="color: rgba(0,0,0,.45)">无权限</span>
          <span v-else>
            {{ summarize(record).read }} 个分栏可读 / {{ summarize(record).write }} 个可写
          </span>
        </template>
        <template v-else-if="column.key === 'lastLoginAt'">
          {{ record.lastLoginAt ? new Date(record.lastLoginAt).toLocaleString() : "-" }}
        </template>
        <template v-else-if="column.key === 'createdAt'">
          {{ record.createdAt ? new Date(record.createdAt).toLocaleString() : "-" }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space size="small">
            <a-button size="small" type="link" @click="openEdit(record)">编辑</a-button>
            <a-button size="small" type="link" @click="openResetPassword(record)">重置密码</a-button>
            <a-tooltip v-if="isSelf(record)" title="不能删除当前登录账号">
              <a-button size="small" type="link" danger disabled>删除</a-button>
            </a-tooltip>
            <a-popconfirm
              v-else
              title="确认删除管理员？"
              ok-text="删除"
              ok-type="danger"
              cancel-text="取消"
              @confirm="handleDelete(record)"
            >
              <template #description>
                <div style="max-width: 240px">
                  删除后该管理员将无法登录后台，并从管理员列表中隐藏。该操作会写入审计日志（软删除）。
                </div>
              </template>
              <a-button size="small" type="link" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 新增/编辑弹窗 -->
    <a-modal
      v-model:open="formVisible"
      :title="formMode === 'create' ? '新增管理员' : '编辑管理员'"
      :ok-text="formMode === 'create' ? '创建' : '保存'"
      cancel-text="取消"
      :confirm-loading="submitting"
      width="900px"
      @ok="handleSubmit"
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="用户名" required>
              <a-input v-model:value="form.username" :disabled="formMode === 'edit'" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="显示名称" required>
              <a-input v-model:value="form.displayName" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item :label="formMode === 'create' ? '密码（至少 6 位）' : '新密码（留空则不修改）'">
              <a-input-password v-model:value="form.password" autocomplete="new-password" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="角色" required>
              <a-tooltip v-if="formMode === 'edit' && isEditingSelf" title="不能修改自己的角色">
                <a-select v-model:value="form.role" disabled>
                  <a-select-option value="SUPER_ADMIN">超级管理员</a-select-option>
                  <a-select-option value="ADMIN">普通管理员</a-select-option>
                  <a-select-option value="OPERATOR">运营人员</a-select-option>
                </a-select>
              </a-tooltip>
              <a-select v-else v-model:value="form.role">
                <a-select-option value="SUPER_ADMIN">超级管理员</a-select-option>
                <a-select-option value="ADMIN">普通管理员</a-select-option>
                <a-select-option value="OPERATOR">运营人员</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item v-if="formMode === 'edit'" label="状态">
          <a-tooltip v-if="isEditingSelf" title="不能禁用当前登录账号">
            <a-switch v-model:checked="form.isActive" disabled />
          </a-tooltip>
          <a-switch v-else v-model:checked="form.isActive" />
        </a-form-item>

        <a-divider>权限矩阵</a-divider>
        <AdminPermissionMatrix v-model="form.permissions" :role="form.role as any" />
      </a-form>
    </a-modal>

    <!-- 重置密码弹窗 -->
    <a-modal
      v-model:open="resetVisible"
      title="重置密码"
      ok-text="重置"
      cancel-text="取消"
      :confirm-loading="resetting"
      @ok="handleResetPassword"
    >
      <a-alert
        type="warning"
        show-icon
        message="重置后将立即生效"
        description="重置后请将新密码安全地发送给该管理员，密码本身不会写入审计日志。"
        style="margin-bottom: 12px"
      />
      <a-form layout="vertical">
        <a-form-item label="目标账号">
          <a-input :value="resetTargetLabel" disabled />
        </a-form-item>
        <a-form-item label="新密码（至少 6 位）" required>
          <a-input-password v-model:value="resetForm.newPassword" autocomplete="new-password" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { message } from "ant-design-vue";
import {
  getAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  resetAdminPassword,
} from "@/api/admins";
import { useUserStore } from "@/store/user";
import AdminPermissionMatrix from "@/components/AdminPermissionMatrix.vue";
import {
  ADMIN_SECTIONS,
  normalizePermissions,
  type PermissionMatrix,
} from "@/config/admin-sections";

interface AdminRow {
  id: string;
  username: string;
  displayName: string;
  role: "SUPER_ADMIN" | "ADMIN" | "OPERATOR";
  isActive: boolean;
  permissions: PermissionMatrix | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  deletedAt: string | null;
}

const userStore = useUserStore();

const admins = ref<AdminRow[]>([]);
const loading = ref(false);

const formVisible = ref(false);
const formMode = ref<"create" | "edit">("create");
const submitting = ref(false);
const editingId = ref<string | null>(null);
const form = reactive<{
  username: string;
  displayName: string;
  password: string;
  role: "SUPER_ADMIN" | "ADMIN" | "OPERATOR";
  isActive: boolean;
  permissions: PermissionMatrix;
}>({
  username: "",
  displayName: "",
  password: "",
  role: "OPERATOR",
  isActive: true,
  permissions: {},
});

const isEditingSelf = computed(() => editingId.value === userStore.admin?.id);

const resetVisible = ref(false);
const resetting = ref(false);
const resetTarget = ref<AdminRow | null>(null);
const resetForm = reactive({ newPassword: "" });
const resetTargetLabel = computed(() =>
  resetTarget.value ? `${resetTarget.value.displayName} (${resetTarget.value.username})` : "",
);

const columns = [
  { title: "用户名", dataIndex: "username" },
  { title: "显示名称", dataIndex: "displayName" },
  { title: "角色", key: "role" },
  { title: "状态", key: "active", width: 100 },
  { title: "权限摘要", key: "permissionsSummary", width: 220 },
  { title: "最后登录", key: "lastLoginAt", width: 180 },
  { title: "创建时间", key: "createdAt", width: 180 },
  { title: "操作", key: "action", width: 260 },
];

function roleColor(role: AdminRow["role"]) {
  if (role === "SUPER_ADMIN") return "red";
  if (role === "ADMIN") return "blue";
  return "default";
}
function roleLabel(role: AdminRow["role"]) {
  if (role === "SUPER_ADMIN") return "超级管理员";
  if (role === "ADMIN") return "普通管理员";
  return "运营人员";
}

function isSelf(record: AdminRow) {
  return record.id === userStore.admin?.id;
}

function summarize(record: AdminRow) {
  const perms = normalizePermissions(record.permissions ?? {});
  let read = 0;
  let write = 0;
  for (const s of ADMIN_SECTIONS) {
    if (perms[s.key]?.read) read += 1;
    if (perms[s.key]?.write) write += 1;
  }
  return { read, write };
}

async function fetchData() {
  loading.value = true;
  try {
    admins.value = (await getAdmins()) as AdminRow[];
  } finally {
    loading.value = false;
  }
}

function resetForm$() {
  form.username = "";
  form.displayName = "";
  form.password = "";
  form.role = "OPERATOR";
  form.isActive = true;
  form.permissions = {};
}

function openCreate() {
  formMode.value = "create";
  editingId.value = null;
  resetForm$();
  formVisible.value = true;
}

function openEdit(record: AdminRow) {
  formMode.value = "edit";
  editingId.value = record.id;
  form.username = record.username;
  form.displayName = record.displayName;
  form.password = "";
  form.role = record.role;
  form.isActive = record.isActive;
  form.permissions = normalizePermissions(record.permissions ?? {});
  formVisible.value = true;
}

async function handleSubmit() {
  if (!form.username || form.username.length < 3) {
    message.error("用户名至少 3 位");
    return;
  }
  if (!form.displayName) {
    message.error("请填写显示名称");
    return;
  }
  if (formMode.value === "create" && (!form.password || form.password.length < 6)) {
    message.error("密码至少 6 位");
    return;
  }
  if (formMode.value === "edit" && form.password && form.password.length < 6) {
    message.error("密码至少 6 位");
    return;
  }

  submitting.value = true;
  try {
    const payload: Record<string, unknown> = {
      displayName: form.displayName,
      role: form.role,
      permissions: form.role === "SUPER_ADMIN" ? undefined : form.permissions,
    };

    if (formMode.value === "create") {
      payload.username = form.username;
      payload.password = form.password;
      await createAdmin(payload);
      message.success("管理员已创建");
    } else if (editingId.value) {
      payload.isActive = form.isActive;
      if (form.password) payload.password = form.password;
      await updateAdmin(editingId.value, payload);
      message.success("管理员已更新");
    }
    formVisible.value = false;
    await fetchData();
  } finally {
    submitting.value = false;
  }
}

async function handleToggle(record: AdminRow, nextActive: boolean) {
  await updateAdmin(record.id, { isActive: nextActive });
  message.success(nextActive ? "已启用" : "已禁用");
  await fetchData();
}

async function handleDelete(record: AdminRow) {
  await deleteAdmin(record.id);
  message.success("管理员已删除");
  await fetchData();
}

function openResetPassword(record: AdminRow) {
  resetTarget.value = record;
  resetForm.newPassword = "";
  resetVisible.value = true;
}

async function handleResetPassword() {
  if (!resetTarget.value) return;
  if (!resetForm.newPassword || resetForm.newPassword.length < 6) {
    message.error("密码至少 6 位");
    return;
  }
  resetting.value = true;
  try {
    await resetAdminPassword(resetTarget.value.id, resetForm.newPassword);
    message.success("密码已重置");
    resetVisible.value = false;
  } finally {
    resetting.value = false;
  }
}

onMounted(fetchData);
</script>
