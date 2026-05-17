import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { useUserStore } from "@/store/user";
import type { SectionKey } from "@/config/admin-sections";

const BasicLayout = () => import("@/layouts/BasicLayout.vue");

// 路由 meta：permission 指向 14 个分栏 key；action 仅用 read（写按钮 gating 由组件控制）
type AdminRouteMeta = {
  title?: string;
  public?: boolean;
  permission?: SectionKey;
  action?: "read";
  // 仅 SUPER_ADMIN 可访问的页面，例如管理员管理
  superOnly?: boolean;
};

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/login/index.vue"),
    meta: { public: true } satisfies AdminRouteMeta,
  },
  {
    path: "/403",
    name: "Forbidden",
    component: () => import("@/views/403.vue"),
    meta: { title: "无访问权限" } satisfies AdminRouteMeta,
  },
  {
    path: "/",
    component: BasicLayout,
    redirect: () => "/dashboard",
    children: [
      { path: "dashboard", name: "Dashboard", component: () => import("@/views/dashboard/index.vue"), meta: { title: "仪表盘", permission: "dashboard", action: "read" } satisfies AdminRouteMeta },
      { path: "users", name: "UserList", component: () => import("@/views/user/list.vue"), meta: { title: "用户管理", permission: "users", action: "read" } satisfies AdminRouteMeta },
      { path: "users/:id", name: "UserDetail", component: () => import("@/views/user/detail.vue"), meta: { title: "用户详情", permission: "users", action: "read" } satisfies AdminRouteMeta },
      { path: "projects", name: "ProjectList", component: () => import("@/views/project/list.vue"), meta: { title: "项目管理", permission: "projects", action: "read" } satisfies AdminRouteMeta },
      { path: "projects/:id", name: "ProjectDetail", component: () => import("@/views/project/detail.vue"), meta: { title: "项目详情", permission: "projects", action: "read" } satisfies AdminRouteMeta },
      { path: "series", name: "SeriesList", component: () => import("@/views/series/list.vue"), meta: { title: "Series 项目集", permission: "series", action: "read" } satisfies AdminRouteMeta },
      { path: "series/new", name: "SeriesCreate", component: () => import("@/views/series/create.vue"), meta: { title: "新建 Series", permission: "series", action: "read" } satisfies AdminRouteMeta },
      { path: "series/:id", name: "SeriesDetail", component: () => import("@/views/series/detail.vue"), meta: { title: "Series 详情", permission: "series", action: "read" } satisfies AdminRouteMeta },
      { path: "canvas-projects", name: "CanvasProjectList", component: () => import("@/views/canvas-project/list.vue"), meta: { title: "AI 画布项目", permission: "canvasProjects", action: "read" } satisfies AdminRouteMeta },
      { path: "canvas-projects/:id", name: "CanvasProjectDetail", component: () => import("@/views/canvas-project/detail.vue"), meta: { title: "画布项目详情", permission: "canvasProjects", action: "read" } satisfies AdminRouteMeta },
      { path: "canvas-channel-stats", name: "CanvasChannelStats", component: () => import("@/views/canvas-channel-stats/index.vue"), meta: { title: "画布渠道统计", permission: "canvasChannelStats", action: "read" } satisfies AdminRouteMeta },
      { path: "tasks", name: "TaskList", component: () => import("@/views/task/list.vue"), meta: { title: "任务管理", permission: "tasks", action: "read" } satisfies AdminRouteMeta },
      { path: "tasks/:id", name: "TaskDetail", component: () => import("@/views/task/detail.vue"), meta: { title: "任务详情", permission: "tasks", action: "read" } satisfies AdminRouteMeta },
      { path: "prompts", name: "PromptList", component: () => import("@/views/prompt/list.vue"), meta: { title: "Prompt 管理", permission: "prompts", action: "read" } satisfies AdminRouteMeta },
      { path: "prompts/:id", name: "PromptEdit", component: () => import("@/views/prompt/edit.vue"), meta: { title: "Prompt 编辑", permission: "prompts", action: "read" } satisfies AdminRouteMeta },
      { path: "token-usage", name: "TokenUsage", component: () => import("@/views/token-usage/index.vue"), meta: { title: "Token 统计", permission: "tokenUsage", action: "read" } satisfies AdminRouteMeta },
      { path: "user-action-logs", name: "UserActionLogs", component: () => import("@/views/user-action-log/index.vue"), meta: { title: "用户操作日志", permission: "userActionLogs", action: "read" } satisfies AdminRouteMeta },
      { path: "audit-logs", name: "AuditLogs", component: () => import("@/views/audit-log/index.vue"), meta: { title: "审计日志", permission: "auditLogs", action: "read" } satisfies AdminRouteMeta },
      { path: "system/credentials", name: "Credentials", component: () => import("@/views/system/credentials.vue"), meta: { title: "凭据池", permission: "credentials", action: "read" } satisfies AdminRouteMeta },
      { path: "system/defaults", name: "Defaults", component: () => import("@/views/system/defaults.vue"), meta: { title: "默认模型", permission: "defaults", action: "read" } satisfies AdminRouteMeta },
      { path: "system/model-registry", name: "ModelRegistry", component: () => import("@/views/system/model-registry.vue"), meta: { title: "模型注册表", permission: "modelRegistry", action: "read" } satisfies AdminRouteMeta },
      // PRD §14.16：providers 入口隐藏，历史访问重定向到凭据池
      { path: "system/providers", redirect: "/system/credentials" },
      { path: "system/global-config", name: "GlobalConfig", component: () => import("@/views/system/global-config.vue"), meta: { title: "全局配置", permission: "globalConfig", action: "read" } satisfies AdminRouteMeta },
      { path: "system/admins", name: "AdminList", component: () => import("@/views/system/admin-list.vue"), meta: { title: "管理员管理", superOnly: true } satisfies AdminRouteMeta },
    ],
  },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const meta = (to.meta ?? {}) as AdminRouteMeta;
  if (meta.public) return true;

  const userStore = useUserStore();
  if (!userStore.isLoggedIn()) return { path: "/login" };

  // 首屏或刷新后还没有 profile：先把 profile + permissions 拉好再继续
  await userStore.ensureProfile();

  // 拉完 profile 仍未登录态（profile 报错触发 logout）→ 回登录页
  if (!userStore.isLoggedIn()) return { path: "/login" };

  // /403 不再做权限校验，避免循环
  if (to.path === "/403") return true;

  // SUPER_ADMIN 直接放行
  if (userStore.isSuper()) {
    // /dashboard 路径下，如果是空首屏跳第一个可读分栏
    return true;
  }

  if (meta.superOnly) return { path: "/403" };

  // 业务路由：必须命中 read 权限
  if (meta.permission) {
    const ok = userStore.canRead(meta.permission);
    if (!ok) return { path: "/403" };
    return true;
  }

  // 没有 permission meta 的内部路由（如 layout 兜底）默认放行
  return true;
});

// 让 / 重定向到第一个有权限的分栏；这里 routes 写死 redirect: '/dashboard'，
// 实际首屏由布局或 dashboard 自身处理无权限场景。这里再多一层兜底守卫。
router.beforeEach((to) => {
  if (to.path !== "/") return true;
  const userStore = useUserStore();
  if (userStore.isSuper()) return { path: "/dashboard" };
  const first = userStore.firstReadableRoutePath();
  if (first) return { path: first };
  return { path: "/403" };
});

export default router;
