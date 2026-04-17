import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash } from "bcryptjs";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { createAuditLog } from "../../common/audit.js";

const updateUserSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
  quota: z.any().optional(),
  remark: z.string().optional(),
});

const listQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
  sort: z.enum(["createdAt", "email", "name"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { name: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [query.sort]: query.order },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          quota: true,
          remark: true,
          createdAt: true,
          _count: { select: { projects: true, tokenUsages: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        quota: true,
        remark: true,
        createdAt: true,
        _count: { select: { projects: true, apiConfigs: true, tokenUsages: true } },
      },
    });

    if (!user) return reply.code(404).send({ error: "用户不存在" });

    const tokenSummary = await prisma.tokenUsageLog.aggregate({
      where: { userId: id },
      _sum: { totalTokens: true },
    });

    return { ...user, totalTokens: tokenSummary._sum.totalTokens?.toString() ?? "0" };
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "用户不存在" });

    const data: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.quota !== undefined) data.quota = parsed.data.quota;
    if (parsed.data.remark !== undefined) data.remark = parsed.data.remark;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "无有效字段" });
    }

    const after = await prisma.user.update({ where: { id }, data });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "user.update",
      targetType: "User",
      targetId: id,
      before: { status: before.status, quota: before.quota, remark: before.remark },
      after: data,
      ip: request.ip,
    });

    return after;
  });

  app.post("/:id/reset-password", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: "用户不存在" });

    const tempPassword = Math.random().toString(36).slice(-10);
    const passwordHash = await hash(tempPassword, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "user.reset_password",
      targetType: "User",
      targetId: id,
      ip: request.ip,
    });

    return { message: "密码已重置", tempPassword };
  });
}
