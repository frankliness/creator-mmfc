import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";

const listQuerySchema = paginationSchema.extend({
  userId: z.string().optional(),
  category: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function userActionLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.category) where.category = query.category;
    if (query.action) where.action = { contains: query.action, mode: "insensitive" };
    if (query.targetType) where.targetType = query.targetType;
    if (query.projectId) where.projectId = query.projectId;
    if (query.taskId) where.taskId = query.taskId;
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { targetId: { contains: query.search, mode: "insensitive" } },
        { projectId: { contains: query.search, mode: "insensitive" } },
        { storyboardId: { contains: query.search, mode: "insensitive" } },
        { taskId: { contains: query.search, mode: "insensitive" } },
        { route: { contains: query.search, mode: "insensitive" } },
        { user: { is: { email: { contains: query.search, mode: "insensitive" } } } },
        { user: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    let data;
    let total;
    try {
      [data, total] = await Promise.all([
        prisma.userActionLog.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        }),
        prisma.userActionLog.count({ where }),
      ]);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2021"
      ) {
        return paginatedResponse([], 0, query.page, query.size);
      }
      throw err;
    }

    return paginatedResponse(data, total, query.page, query.size);
  });
}
