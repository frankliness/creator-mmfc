import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { createAuditLog } from "../../common/audit.js";
import { z } from "zod";

const listQuerySchema = paginationSchema.extend({
  userId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };

    const [data, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, status: true, creationMode: true,
          ratio: true, resolution: true, style: true,
          createdAt: true, updatedAt: true,
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { storyboards: true } },
        },
      }),
      prisma.project.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true } },
        storyboards: {
          orderBy: { sortOrder: "asc" },
          include: { tasks: { orderBy: { createdAt: "desc" } } },
        },
      },
    });

    if (!project) return reply.code(404).send({ error: "项目不存在" });
    return project;
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: "项目不存在" });

    await prisma.project.delete({ where: { id } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "project.delete",
      targetType: "Project",
      targetId: id,
      before: { name: project.name, userId: project.userId },
      ip: request.ip,
    });

    return { message: "项目已删除" };
  });
}
