import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const BasicLayout = () => import("@/layouts/BasicLayout.vue");

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/login/index.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    component: BasicLayout,
    redirect: "/dashboard",
    children: [
      { path: "dashboard", name: "Dashboard", component: () => import("@/views/dashboard/index.vue"), meta: { title: "仪表盘" } },
      { path: "users", name: "UserList", component: () => import("@/views/user/list.vue"), meta: { title: "用户管理" } },
      { path: "users/:id", name: "UserDetail", component: () => import("@/views/user/detail.vue"), meta: { title: "用户详情" } },
      { path: "projects", name: "ProjectList", component: () => import("@/views/project/list.vue"), meta: { title: "项目管理" } },
      { path: "projects/:id", name: "ProjectDetail", component: () => import("@/views/project/detail.vue"), meta: { title: "项目详情" } },
      { path: "tasks", name: "TaskList", component: () => import("@/views/task/list.vue"), meta: { title: "任务管理" } },
      { path: "tasks/:id", name: "TaskDetail", component: () => import("@/views/task/detail.vue"), meta: { title: "任务详情" } },
      { path: "prompts", name: "PromptList", component: () => import("@/views/prompt/list.vue"), meta: { title: "Prompt 管理" } },
      { path: "prompts/:id", name: "PromptEdit", component: () => import("@/views/prompt/edit.vue"), meta: { title: "Prompt 编辑" } },
      { path: "token-usage", name: "TokenUsage", component: () => import("@/views/token-usage/index.vue"), meta: { title: "Token 统计" } },
      { path: "audit-logs", name: "AuditLogs", component: () => import("@/views/audit-log/index.vue"), meta: { title: "审计日志" } },
      { path: "system/global-config", name: "GlobalConfig", component: () => import("@/views/system/global-config.vue"), meta: { title: "全局配置", role: "SUPER_ADMIN" } },
      { path: "system/admins", name: "AdminList", component: () => import("@/views/system/admin-list.vue"), meta: { title: "管理员管理", role: "SUPER_ADMIN" } },
    ],
  },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to, _from, next) => {
  if (to.meta.public) return next();
  const token = localStorage.getItem("admin_token");
  if (!token) return next("/login");
  next();
});

export default router;
