<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider v-model:collapsed="collapsed" collapsible theme="dark">
      <div style="height: 32px; margin: 16px; color: #fff; text-align: center; font-size: 16px; font-weight: bold; line-height: 32px">
        {{ collapsed ? "MC" : "MMFC Admin" }}
      </div>
      <a-menu theme="dark" mode="inline" :selected-keys="selectedKeys" @click="onMenuClick">
        <a-menu-item
          v-for="item in mainMenuItems"
          :key="item.routePath"
        >
          <template #icon><component :is="iconFor(item.key)" /></template>
          <span>{{ item.label }}</span>
        </a-menu-item>
        <a-sub-menu v-if="showSystemMenu" key="system">
          <template #icon><SettingOutlined /></template>
          <template #title>系统设置</template>
          <a-menu-item
            v-for="item in systemMenuItems"
            :key="item.routePath"
          >
            {{ item.label }}
          </a-menu-item>
          <a-menu-item v-if="userStore.isSuper()" key="/system/admins">
            管理员管理
          </a-menu-item>
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
          <a-alert
            v-if="!userStore.hasAnyAccess && !userStore.isSuper()"
            type="warning"
            show-icon
            message="当前账号暂无后台访问权限"
            description="请联系超级管理员开通对应分栏权限。"
            style="margin-bottom: 16px"
          />
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
import { ADMIN_SECTIONS, type SectionKey } from "@/config/admin-sections";
import {
  DashboardOutlined, UserOutlined, ProjectOutlined, AppstoreOutlined,
  ThunderboltOutlined, FileTextOutlined, BarChartOutlined, HistoryOutlined,
  AuditOutlined, SettingOutlined,
} from "@ant-design/icons-vue";

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const collapsed = ref(false);

const ICONS: Partial<Record<SectionKey, unknown>> = {
  dashboard: DashboardOutlined,
  users: UserOutlined,
  projects: ProjectOutlined,
  canvasProjects: AppstoreOutlined,
  canvasChannelStats: BarChartOutlined,
  tasks: ThunderboltOutlined,
  prompts: FileTextOutlined,
  tokenUsage: BarChartOutlined,
  userActionLogs: HistoryOutlined,
  auditLogs: AuditOutlined,
};

function iconFor(key: SectionKey) {
  return ICONS[key] ?? AppstoreOutlined;
}

const mainMenuItems = computed(() =>
  ADMIN_SECTIONS.filter((s) => s.group === "main" && userStore.canRead(s.key)),
);

const systemMenuItems = computed(() =>
  ADMIN_SECTIONS.filter((s) => s.group === "system" && userStore.canRead(s.key)),
);

const showSystemMenu = computed(
  () => systemMenuItems.value.length > 0 || userStore.isSuper(),
);

const selectedKeys = computed(() => {
  const path = route.path;
  if (path.startsWith("/users")) return ["/users"];
  if (path.startsWith("/projects")) return ["/projects"];
  if (path.startsWith("/canvas-projects")) return ["/canvas-projects"];
  if (path.startsWith("/tasks")) return ["/tasks"];
  if (path.startsWith("/prompts")) return ["/prompts"];
  if (path.startsWith("/user-action-logs")) return ["/user-action-logs"];
  return [path];
});

function onMenuClick({ key }: { key: string }) {
  router.push(key);
}

function handleLogout() {
  userStore.logout();
  router.push("/login");
}

// 路由守卫已经 ensureProfile，但首屏从 / 进来时仍主动触发一次确保 layout 拿到最新数据
onMounted(() => { userStore.ensureProfile(); });
</script>
