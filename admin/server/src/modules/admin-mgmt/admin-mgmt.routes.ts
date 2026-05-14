import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hash } from "bcryptjs";
import { prisma } from "../../common/prisma.js";
import { requireSuperAdmin } from "../../common/guards/permission.js";
import { createAuditLog } from "../../common/audit.js";
import {
  ADMIN_SECTION_KEYS,
  normalizePermissions,
  type PermissionMatrix,
} from "../../common/permissions/sections.js";

// 权限矩阵 zod schema：接受任意 string key（部分传），normalizePermissions 过滤非法 key
const permissionsSchema = z
  .record(
    z.string(),
    z.object({ read: z.boolean(), write: z.boolean() }),
  )
  .optional();

const createSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  displayName: z.string().min(1),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]),
  permissions: permissionsSchema,
});

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
  permissions: permissionsSchema,
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
});

// 计算「除目标 admin 之外的活跃 SUPER_ADMIN 数量」
async function countOtherActiveSuperAdmins(excludeId: string): Promise<number> {
  return prisma.adminUser.count({
    where: {
      id: { not: excludeId },
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    },
  });
}

// 判断本次变更后该 admin 是否仍是「活跃 SUPER_ADMIN」
function willRemainActiveSuper(
  current: { role: string; isActive: boolean; deletedAt: Date | null },
  patch: { role?: string; isActive?: boolean; softDelete?: boolean },
): boolean {
  if (patch.softDelete) return false;
  const role = patch.role ?? current.role;
  const isActive = patch.isActive ?? current.isActive;
  return role === "SUPER_ADMIN" && isActive && current.deletedAt === null;
}

// 自我保护 + 最后一个 SUPER_ADMIN 保护
async function guardLastSuperAdmin(
  reply: FastifyReply,
  target: { id: string; role: string; isActive: boolean; deletedAt: Date | null },
  patch: { role?: string; isActive?: boolean; softDelete?: boolean },
): Promise<boolean> {
  // 当前是活跃 SUPER_ADMIN，且变更后不再是 → 必须有其他活跃 SUPER_ADMIN 兜底
  const wasActiveSuper =
    target.role === "SUPER_ADMIN" && target.isActive && target.deletedAt === null;
  const stillActiveSuper = willRemainActiveSuper(target, patch);
  if (wasActiveSuper && !stillActiveSuper) {
    const others = await countOtherActiveSuperAdmins(target.id);
    if (others === 0) {
      reply.code(400).send({ error: "系统必须至少保留一个启用状态的超级管理员" });
      return false;
    }
  }
  return true;
}

export async function adminMgmtRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSuperAdmin());

  app.get("/", async (request) => {
    const query = request.query as { includeDeleted?: string };
    const includeDeleted = query.includeDeleted === "true";
    return prisma.adminUser.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        permissions: true,
        lastLoginAt: true,
        deletedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const existing = await prisma.adminUser.findUnique({
      where: { username: parsed.data.username },
    });
    if (existing) return reply.code(409).send({ error: "用户名已存在" });

    const passwordHash = await hash(parsed.data.password, 12);
    // SUPER_ADMIN 不依赖 permissions 字段，建账号时强制清空避免误导
    const permissions: PermissionMatrix | null =
      parsed.data.role === "SUPER_ADMIN"
        ? null
        : normalizePermissions(parsed.data.permissions ?? {});

    const admin = await prisma.adminUser.create({
      data: {
        username: parsed.data.username,
        passwordHash,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        permissions: permissions ?? undefined,
      },
    });

    const currentAdmin = request.adminUser!;
    await createAuditLog({
      adminId: currentAdmin.id,
      action: "admin.create",
      targetType: "AdminUser",
      targetId: admin.id,
      after: {
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        permissions,
      },
      ip: request.ip,
    });

    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      isActive: admin.isActive,
      permissions: admin.permissions,
    };
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return reply.code(404).send({ error: "管理员不存在" });
    }

    const currentAdmin = request.adminUser!;
    const isSelf = currentAdmin.id === id;

    // 自我保护
    if (isSelf) {
      if (parsed.data.role !== undefined && parsed.data.role !== existing.role) {
        return reply.code(400).send({ error: "不能修改自己的角色" });
      }
      if (parsed.data.isActive === false) {
        return reply.code(400).send({ error: "不能禁用当前登录账号" });
      }
    }

    // 最后一个 SUPER_ADMIN 保护
    const ok = await guardLastSuperAdmin(reply, existing, {
      role: parsed.data.role,
      isActive: parsed.data.isActive,
    });
    if (!ok) return;

    const data: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.role !== undefined) data.role = parsed.data.role;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.password) data.passwordHash = await hash(parsed.data.password, 12);

    // permissions：未传 → 不动；显式传 → 规范化后落库；SUPER_ADMIN 角色（含切换后）则强制清空
    const targetRole = (parsed.data.role ?? existing.role) as
      | "SUPER_ADMIN"
      | "ADMIN"
      | "OPERATOR";
    let permissionsAfter: PermissionMatrix | null | undefined;
    if (targetRole === "SUPER_ADMIN") {
      // 切到 SUPER_ADMIN 或目标本就是 SUPER_ADMIN：清空 permissions
      if (existing.permissions !== null || parsed.data.permissions !== undefined) {
        data.permissions = null;
        permissionsAfter = null;
      }
    } else if (parsed.data.permissions !== undefined) {
      permissionsAfter = normalizePermissions(parsed.data.permissions);
      data.permissions = permissionsAfter;
    }

    const updated = await prisma.adminUser.update({ where: { id }, data });

    // 审计：避免把 passwordHash 落进 after
    const safeAfter: Record<string, unknown> = { ...data };
    if ("passwordHash" in safeAfter) {
      safeAfter.passwordHash = "<redacted>";
    }

    // 推导本次主要动作
    const actions: string[] = [];
    if ("role" in data) actions.push("updateRole");
    if ("isActive" in data) actions.push("toggleActive");
    if ("permissions" in data) actions.push("updatePermissions");
    if ("passwordHash" in data) actions.push("resetPassword");
    const action = actions.length === 1 ? `admin.${actions[0]}` : "admin.update";

    await createAuditLog({
      adminId: currentAdmin.id,
      action,
      targetType: "AdminUser",
      targetId: id,
      before: {
        displayName: existing.displayName,
        role: existing.role,
        isActive: existing.isActive,
        permissions: existing.permissions,
      },
      after: safeAfter,
      ip: request.ip,
    });

    return {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      isActive: updated.isActive,
      permissions: updated.permissions,
    };
  });

  app.post("/:id/reset-password", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return reply.code(404).send({ error: "管理员不存在" });
    }

    const passwordHash = await hash(parsed.data.newPassword, 12);
    await prisma.adminUser.update({ where: { id }, data: { passwordHash } });

    const currentAdmin = request.adminUser!;
    await createAuditLog({
      adminId: currentAdmin.id,
      action: "admin.resetPassword",
      targetType: "AdminUser",
      targetId: id,
      // 密码明文 / hash 永不进审计
      after: { passwordHash: "<redacted>" },
      ip: request.ip,
    });

    return { message: "密码已重置" };
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const currentAdmin = request.adminUser!;

    if (currentAdmin.id === id) {
      return reply.code(400).send({ error: "不能删除当前登录账号" });
    }

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return reply.code(404).send({ error: "管理员不存在" });
    }

    const ok = await guardLastSuperAdmin(reply, existing, { softDelete: true });
    if (!ok) return;

    await prisma.adminUser.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await createAuditLog({
      adminId: currentAdmin.id,
      action: "admin.softDelete",
      targetType: "AdminUser",
      targetId: id,
      before: {
        username: existing.username,
        role: existing.role,
        isActive: existing.isActive,
      },
      after: { deletedAt: new Date().toISOString(), isActive: false },
      ip: request.ip,
    });

    return { message: "管理员已删除" };
  });
}
