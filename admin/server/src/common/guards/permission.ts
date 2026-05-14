import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../prisma.js";
import {
  normalizePermissions,
  type PermissionMatrix,
  type SectionAction,
  type SectionKey,
} from "../permissions/sections.js";

type AdminContext = {
  id: string;
  username: string;
  displayName: string;
  role: "SUPER_ADMIN" | "ADMIN" | "OPERATOR";
  isActive: boolean;
  permissions: PermissionMatrix;
};

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: AdminContext;
  }
}

// 每请求首次访问时加载实时 admin 状态；禁用 / 软删立即生效。
// 同一请求内多个守卫复用 request.adminUser，避免重复查 DB。
async function loadAdmin(request: FastifyRequest, reply: FastifyReply): Promise<AdminContext | null> {
  if (request.adminUser) return request.adminUser;

  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "未认证" });
    return null;
  }

  const { id } = request.user as { id: string };

  const admin = await prisma.adminUser.findFirst({
    where: { id, isActive: true, deletedAt: null },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      permissions: true,
    },
  });

  if (!admin) {
    reply.code(401).send({ error: "账号不可用" });
    return null;
  }

  const ctx: AdminContext = {
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    isActive: admin.isActive,
    permissions: normalizePermissions(admin.permissions ?? {}),
  };
  request.adminUser = ctx;
  return ctx;
}

// 仅做登录态 + active + 未软删校验，不校验任何分栏权限。
// 用法：app.addHook("preHandler", requireLogin())
export function requireLogin() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await loadAdmin(request, reply);
  };
}

// 分栏级守卫：SUPER_ADMIN 直接放行，普通角色按 permissions 矩阵命中。
export function requirePermission(section: SectionKey, action: SectionAction) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await loadAdmin(request, reply);
    if (!admin) return;
    if (admin.role === "SUPER_ADMIN") return;

    const sec = admin.permissions[section];
    const ok = action === "read" ? !!sec?.read : !!sec?.write;
    if (!ok) {
      reply.code(403).send({ error: "权限不足" });
      return;
    }
  };
}

// admin 用户管理强制仅 SUPER_ADMIN。
export function requireSuperAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await loadAdmin(request, reply);
    if (!admin) return;
    if (admin.role !== "SUPER_ADMIN") {
      reply.code(403).send({ error: "权限不足" });
      return;
    }
  };
}
