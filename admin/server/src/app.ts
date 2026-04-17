import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { userRoutes } from "./modules/user/user.routes.js";
import { projectRoutes } from "./modules/project/project.routes.js";
import { taskRoutes } from "./modules/task/task.routes.js";
import { apiConfigRoutes } from "./modules/api-config/api-config.routes.js";
import { globalConfigRoutes } from "./modules/global-config/global-config.routes.js";
import { promptRoutes } from "./modules/prompt/prompt.routes.js";
import { tokenUsageRoutes } from "./modules/token-usage/token-usage.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { auditLogRoutes } from "./modules/audit-log/audit-log.routes.js";
import { adminMgmtRoutes } from "./modules/admin-mgmt/admin-mgmt.routes.js";

function parseCorsOrigins(): string | string[] {
  const raw = process.env.CORS_ORIGIN || "http://localhost:8080";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length <= 1 ? list[0] ?? "http://localhost:8080" : list;
}

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: parseCorsOrigins(),
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.ADMIN_JWT_SECRET || "dev-secret-change-me",
  });

  await app.register(authRoutes, { prefix: "/api/admin/auth" });
  await app.register(userRoutes, { prefix: "/api/admin/users" });
  await app.register(projectRoutes, { prefix: "/api/admin/projects" });
  await app.register(taskRoutes, { prefix: "/api/admin/tasks" });
  await app.register(apiConfigRoutes, { prefix: "/api/admin" });
  await app.register(globalConfigRoutes, { prefix: "/api/admin/global-configs" });
  await app.register(promptRoutes, { prefix: "/api/admin/prompts" });
  await app.register(tokenUsageRoutes, { prefix: "/api/admin/token-usage" });
  await app.register(dashboardRoutes, { prefix: "/api/admin/dashboard" });
  await app.register(auditLogRoutes, { prefix: "/api/admin/audit-logs" });
  await app.register(adminMgmtRoutes, { prefix: "/api/admin/admins" });

  app.get("/api/admin/health", async () => ({ status: "ok" }));

  return app;
}
