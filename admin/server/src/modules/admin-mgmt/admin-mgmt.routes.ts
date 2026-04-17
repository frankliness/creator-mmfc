import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash } from "bcryptjs";
import { prisma } from "../../common/prisma.js";
import { requireRole } from "../../common/guards/rbac.js";
import { createAuditLog } from "../../common/audit.js";

const createSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  displayName: z.string().min(1),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]),
});

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export async function adminMgmtRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("SUPER_ADMIN"));

  app.get("/", async () => {
    return prisma.adminUser.findMany({
      select: {
        id: true, username: true, displayName: true,
        role: true, isActive: true, lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const existing = await prisma.adminUser.findUnique({ where: { username: parsed.data.username } });
    if (existing) return reply.code(409).send({ error: "用户名已存在" });

    const passwordHash = await hash(parsed.data.password, 12);
    const admin = await prisma.adminUser.create({
      data: {
        username: parsed.data.username,
        passwordHash,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
      },
    });

    const currentAdmin = request.user as { id: string };
    await createAuditLog({
      adminId: currentAdmin.id,
      action: "admin.create",
      targetType: "AdminUser",
      targetId: admin.id,
      after: { username: admin.username, role: admin.role },
      ip: request.ip,
    });

    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
    };
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "管理员不存在" });

    const data: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.role !== undefined) data.role = parsed.data.role;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.password) data.passwordHash = await hash(parsed.data.password, 12);

    const updated = await prisma.adminUser.update({ where: { id }, data });

    const currentAdmin = request.user as { id: string };
    await createAuditLog({
      adminId: currentAdmin.id,
      action: "admin.update",
      targetType: "AdminUser",
      targetId: id,
      before: { role: existing.role, isActive: existing.isActive },
      after: data,
      ip: request.ip,
    });

    return {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      isActive: updated.isActive,
    };
  });
}
