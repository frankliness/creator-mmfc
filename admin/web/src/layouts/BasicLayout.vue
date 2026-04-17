<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider v-model:collapsed="collapsed" collapsible theme="dark">
      <div style="height: 32px; margin: 16px; color: #fff; text-align: center; font-size: 16px; font-weight: bold; line-height: 32px">
        {{ collapsed ? "MC" : "MMFC Admin" }}
      </div>
      <a-menu theme="dark" mode="inline" :selected-keys="selectedKeys" @click="onMenuClick">
        <a-menu-item key="/dashboard">
          <template #icon><DashboardOutlined /></template>
          <span>仪表盘</span>
        </a-menu-item>
        <a-menu-item key="/users">
          <template #icon><UserOutlined /></template>
          <span>用户管理</span>
        </a-menu-item>
        <a-menu-item key="/projects">
          <template #icon><ProjectOutlined /></template>
          <span>项目管理</span>
        </a-menu-item>
        <a-menu-item key="/tasks">
          <template #icon><ThunderboltOutlined /></template>
          <span>任务管理</span>
        </a-menu-item>
        <a-menu-item key="/prompts">
          <template #icon><FileTextOutlined /></template>
          <span>Prompt 管理</span>
        </a-menu-item>
        <a-menu-item key="/token-usage">
          <template #icon><BarChartOutlined /></template>
          <span>Token 统计</span>
        </a-menu-item>
        <a-menu-item key="/audit-logs">
          <template #icon><AuditOutlined /></template>
          <span>审计日志</span>
        </a-menu-item>
        <a-sub-menu key="system">
          <template #icon><SettingOutlined /></template>
          <template #title>系统设置</template>
          <a-menu-item key="/system/global-config">全局配置</a-menu-item>
          <a-menu-item key="/system/admins">管理员管理</a-menu-item>
        </a-sub-menu>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header style="background: #fff; padding: 0 24px; display: flex; align-items: center; justify-content: space-between">
        <a-breadcrumb>
          <a-breadcrumb-item>{{ $route.meta.title || "管理后台" }}</a-breadcrumb-item>
        </a-breadcrumb>
        <a-dropdown>
          <a-space style="cursor: pointer">
            <a-avatar style="background-color: #1890ff">{{ userStore.admin?.displayName?.[0] || "A" }}</a-avatar>
            <span>{{ userStore.admin?.displayName || "管理员" }}</span>
          </a-space>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="handleLogout">退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>
      <a-layout-content style="margin: 16px">
        <div style="padding: 24px; background: #fff; min-height: 360px; border-radius: 8px">
          <router-view />
        </div>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useUserStore } from "@/store/user";
import {
  DashboardOutlined, UserOutlined, ProjectOutlined,
  ThunderboltOutlined, FileTextOutlined, BarChartOutlined,
  AuditOutlined, SettingOutlined,
} from "@ant-design/icons-vue";

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const collapsed = ref(false);

const selectedKeys = computed(() => {
  const path = route.path;
  if (path.startsWith("/users")) return ["/users"];
  if (path.startsWith("/projects")) return ["/projects"];
  if (path.startsWith("/tasks")) return ["/tasks"];
  if (path.startsWith("/prompts")) return ["/prompts"];
  return [path];
});

function onMenuClick({ key }: { key: string }) {
  router.push(key);
}

function handleLogout() {
  userStore.logout();
  router.push("/login");
}

onMounted(() => { userStore.fetchProfile(); });
</script>
