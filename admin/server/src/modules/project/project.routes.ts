import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { createAuditLog } from "../../common/audit.js";
import { Prisma } from "@prisma/client";
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

    const projectIds = data.map((item) => item.id);
    const tokenRows = projectIds.length === 0
      ? []
      : await prisma.$queryRaw<
          { projectId: string; provider: string; model: string; total: bigint; count: bigint }[]
        >(Prisma.sql`
          SELECT "projectId",
                 "provider",
                 "model",
                 SUM("totalTokens") AS total,
                 COUNT(*)::bigint AS count
          FROM "TokenUsageLog"
          WHERE "projectId" IN (${Prisma.join(projectIds)})
          GROUP BY "projectId", "provider", "model"
        `);

    const tokenMap = new Map<string, { totalTokens: string; requestCount: number; byModel: Array<{ provider: string; model: string; total: string; count: number }> }>();
    for (const row of tokenRows) {
      const entry = tokenMap.get(row.projectId) ?? {
        totalTokens: "0",
        requestCount: 0,
        byModel: [],
      };
      // $queryRaw 的 SUM(bigint) 经 Prisma 映射后不是 JS bigint，直接与 BigInt 相加会退化成字符串拼接（如 "0"+139756 → "0139756"）。
      entry.totalTokens = (BigInt(entry.totalTokens) + BigInt(String(row.total))).toString();
      entry.requestCount += Number(row.count);
      entry.byModel.push({
        provider: row.provider,
        model: row.model,
        total: row.total.toString(),
        count: Number(row.count),
      });
      tokenMap.set(row.projectId, entry);
    }

    const enriched = data.map((item) => ({
      ...item,
      tokenSummary: tokenMap.get(item.id) ?? {
        totalTokens: "0",
        requestCount: 0,
        byModel: [],
      },
    }));

    return paginatedResponse(enriched, total, query.page, query.size);
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
    const [tokenAgg, tokenByModel] = await Promise.all([
      prisma.tokenUsageLog.aggregate({
        where: { projectId: id },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
        _count: true,
      }),
      prisma.$queryRaw<
        { provider: string; model: string; total: bigint; count: bigint }[]
      >(Prisma.sql`
        SELECT "provider",
               "model",
               SUM("totalTokens") AS total,
               COUNT(*)::bigint AS count
        FROM "TokenUsageLog"
        WHERE "projectId" = ${id}
        GROUP BY "provider", "model"
        ORDER BY total DESC
      `),
    ]);

    return {
      ...project,
      tokenSummary: {
        requestCount: tokenAgg._count,
        inputTokens: tokenAgg._sum.inputTokens?.toString() ?? "0",
        outputTokens: tokenAgg._sum.outputTokens?.toString() ?? "0",
        totalTokens: tokenAgg._sum.totalTokens?.toString() ?? "0",
        byModel: tokenByModel.map((row) => ({
          provider: row.provider,
          model: row.model,
          total: row.total.toString(),
          count: Number(row.count),
        })),
      },
    };
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
