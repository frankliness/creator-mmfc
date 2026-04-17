<template>
  <div>
    <a-table :columns="columns" :data-source="configs" :loading="loading" row-key="id" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'value'">
          <a-space>
            <span>{{ record.value }}</span>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
          </a-space>
        </template>
        <template v-if="column.key === 'encrypted'">
          <a-tag :color="record.encrypted ? 'orange' : 'default'">{{ record.encrypted ? '加密' : '明文' }}</a-tag>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="showEdit" :title="`编辑: ${editKey}`" @ok="handleUpdate">
      <a-form layout="vertical">
        <a-form-item label="值">
          <a-input v-model:value="editValue" :type="editEncrypted ? 'password' : 'text'" />
        </a-form-item>
        <a-form-item><a-checkbox v-model:checked="editEncrypted">加密存储</a-checkbox></a-form-item>
        <a-form-item label="备注"><a-input v-model:value="editRemark" /></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { getGlobalConfigs, updateGlobalConfig } from "@/api/global-config";

const configs = ref<any[]>([]);
const loading = ref(false);
const showEdit = ref(false);
const editKey = ref("");
const editValue = ref("");
const editEncrypted = ref(false);
const editRemark = ref("");

const columns = [
  { title: "Key", dataIndex: "key" },
  { title: "Value", key: "value" },
  { title: "存储方式", key: "encrypted" },
  { title: "备注", dataIndex: "remark" },
];

async function fetchData() {
  loading.value = true;
  try { configs.value = (await getGlobalConfigs()) as any; } finally { loading.value = false; }
}

function openEdit(record: any) {
  editKey.value = record.key;
  editValue.value = "";
  editEncrypted.value = record.encrypted;
  editRemark.value = record.remark || "";
  showEdit.value = true;
}

async function handleUpdate() {
  await updateGlobalConfig(editKey.value, { value: editValue.value, encrypted: editEncrypted.value, remark: editRemark.value });
  message.success("配置已更新");
  showEdit.value = false;
  fetchData();
}

onMounted(fetchData);
</script>
