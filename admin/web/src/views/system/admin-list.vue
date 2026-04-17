<template>
  <div>
    <a-button type="primary" @click="showCreate = true" style="margin-bottom: 16px">新增管理员</a-button>
    <a-table :columns="columns" :data-source="admins" :loading="loading" row-key="id">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'role'">
          <a-tag :color="record.role === 'SUPER_ADMIN' ? 'red' : record.role === 'ADMIN' ? 'blue' : 'default'">{{ record.role }}</a-tag>
        </template>
        <template v-if="column.key === 'active'">
          <a-switch :checked="record.isActive" @change="(v: boolean) => handleToggle(record.id, v)" />
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="showCreate" title="新增管理员" @ok="handleCreate">
      <a-form layout="vertical">
        <a-form-item label="用户名"><a-input v-model:value="createForm.username" /></a-form-item>
        <a-form-item label="密码"><a-input-password v-model:value="createForm.password" /></a-form-item>
        <a-form-item label="显示名称"><a-input v-model:value="createForm.displayName" /></a-form-item>
        <a-form-item label="角色"><a-select v-model:value="createForm.role">
          <a-select-option value="SUPER_ADMIN">超级管理员</a-select-option>
          <a-select-option value="ADMIN">管理员</a-select-option>
          <a-select-option value="OPERATOR">运营</a-select-option>
        </a-select></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getAdmins, createAdmin, updateAdmin } from "@/api/admins";

const admins = ref<any[]>([]);
const loading = ref(false);
const showCreate = ref(false);
const createForm = reactive({ username: "", password: "", displayName: "", role: "OPERATOR" });

const columns = [
  { title: "用户名", dataIndex: "username" },
  { title: "显示名称", dataIndex: "displayName" },
  { title: "角色", key: "role" },
  { title: "状态", key: "active" },
  { title: "最后登录", dataIndex: "lastLoginAt", customRender: ({ text }: any) => text ? new Date(text).toLocaleString() : "-" },
];

async function fetchData() {
  loading.value = true;
  try { admins.value = (await getAdmins()) as any; } finally { loading.value = false; }
}

async function handleCreate() {
  await createAdmin(createForm);
  message.success("管理员已创建");
  showCreate.value = false;
  fetchData();
}

async function handleToggle(id: string, isActive: boolean) {
  await updateAdmin(id, { isActive });
  message.success(isActive ? "已启用" : "已禁用");
  fetchData();
}

onMounted(fetchData);
</script>
