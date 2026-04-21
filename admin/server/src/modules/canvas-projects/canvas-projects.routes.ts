import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CanvasStatus, Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { createAuditLog } from "../../common/audit.js";
import { deleteLocalCanvasAsset } from "../../common/canvas-files.js";

const listQuerySchema = paginationSchema.extend({
  userId: z.string().optional(),
  status: z.nativeEnum(CanvasStatus).optional(),
  search: z.string().optional(),
});

const patchBodySchema = z.object({
  status: z.nativeEnum(CanvasStatus),
});

export async function canvasProjectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Prisma.CanvasProjectWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      prisma.canvasProject.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { nodes: true, edges: true, assets: true, aiCalls: true } },
        },
      }),
      prisma.canvasProject.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await prisma.canvasProject.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true } },
        _count: { select: { nodes: true, edges: true, assets: true, aiCalls: true } },
      },
    });
    if (!project) return reply.code(404).send({ error: "画布项目不存在" });

    const tokenAgg = await prisma.canvasAiCall.aggregate({
      where: { projectId: id },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
      _count: true,
    });

    const recentCalls = await prisma.canvasAiCall.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        callType: true,
        model: true,
        totalTokens: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      ...project,
      tokenSummary: {
        totalCalls: tokenAgg._count,
        totalTokens: tokenAgg._sum.totalTokens?.toString() ?? "0",
        inputTokens: tokenAgg._sum.inputTokens?.toString() ?? "0",
        outputTokens: tokenAgg._sum.outputTokens?.toString() ?? "0",
      },
      recentCalls,
    };
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const before = await prisma.canvasProject.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "画布项目不存在" });

    const updated = await prisma.canvasProject.update({
      where: { id },
      data: { status: parsed.data.status },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "canvas_project.update",
      targetType: "CanvasProject",
      targetId: id,
      before: { status: before.status },
      after: { status: parsed.data.status },
      ip: request.ip,
    });

    return updated;
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await prisma.canvasProject.findUnique({
      where: { id },
      include: { assets: { select: { localPath: true } } },
    });
    if (!project) return reply.code(404).send({ error: "画布项目不存在" });

    for (const a of project.assets) {
      deleteLocalCanvasAsset(a.localPath);
    }

    await prisma.$transaction([
      prisma.canvasAiCall.deleteMany({ where: { projectId: id } }),
      prisma.tokenUsageLog.deleteMany({
        where: { projectId: id, provider: "gemini-canvas" },
      }),
      prisma.canvasProject.delete({ where: { id } }),
    ]);

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "canvas_project.delete",
      targetType: "CanvasProject",
      targetId: id,
      before: { name: project.name, userId: project.userId },
      ip: request.ip,
    });

    return { message: "画布项目及关联数据已删除" };
  });
}
