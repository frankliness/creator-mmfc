import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";

const listQuerySchema = paginationSchema.extend({
  adminId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function auditLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.adminId) where.adminId = query.adminId;
    if (query.action) where.action = { contains: query.action };
    if (query.targetType) where.targetType = query.targetType;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          admin: { select: { id: true, username: true, displayName: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });
}
