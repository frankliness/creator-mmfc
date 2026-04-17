import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { z } from "zod";

const listQuerySchema = paginationSchema.extend({
  userId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function taskRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) where.arkTaskId = { contains: query.search };
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    if (query.userId || query.projectId) {
      where.storyboard = {
        project: {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.projectId ? { id: query.projectId } : {}),
        },
      };
    }

    const [data, total] = await Promise.all([
      prisma.generationTask.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, arkTaskId: true, model: true, status: true,
          arkStatus: true, videoUrl: true, seed: true,
          resolution: true, ratio: true, duration: true,
          completionTokens: true, totalTokens: true,
          error: true, createdAt: true, updatedAt: true,
          storyboard: {
            select: {
              id: true, storyboardId: true,
              project: {
                select: {
                  id: true, name: true,
                  user: { select: { id: true, email: true, name: true } },
                },
              },
            },
          },
        },
      }),
      prisma.generationTask.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });

  app.get("/realtime-stats", async () => {
    const [submitted, running, total, failed] = await Promise.all([
      prisma.generationTask.count({ where: { status: "SUBMITTED" } }),
      prisma.generationTask.count({ where: { status: "RUNNING" } }),
      prisma.generationTask.count(),
      prisma.generationTask.count({ where: { status: "FAILED" } }),
    ]);
    return { submitted, running, total, failed };
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.generationTask.findUnique({
      where: { id },
      include: {
        storyboard: {
          include: {
            project: {
              select: {
                id: true, name: true, ratio: true, resolution: true,
                user: { select: { id: true, email: true, name: true } },
              },
            },
          },
        },
        apiConfig: { select: { id: true, provider: true, name: true, endpoint: true } },
      },
    });

    if (!task) return reply.code(404).send({ error: "任务不存在" });
    return task;
  });

  app.post("/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.generationTask.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "任务不存在" });
    if (task.status !== "FAILED") {
      return reply.code(400).send({ error: "只能重试失败的任务" });
    }

    await prisma.generationTask.update({
      where: { id },
      data: { status: "SUBMITTED", error: null, arkStatus: null },
    });

    return { message: "任务已重新提交" };
  });
}
