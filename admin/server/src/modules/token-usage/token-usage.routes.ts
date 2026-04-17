import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { Prisma } from "@prisma/client";

const summaryQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "all"]).default("day"),
  userId: z.string().optional(),
  provider: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const detailQuerySchema = paginationSchema.extend({
  userId: z.string().optional(),
  provider: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function tokenUsageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/summary", async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const fromDate = query.from
      ? new Date(query.from)
      : new Date(Date.now() - query.days * 86400000);
    const toDate = query.to ? new Date(query.to) : new Date();

    const conditions: string[] = [`"createdAt" >= '${fromDate.toISOString()}'`, `"createdAt" <= '${toDate.toISOString()}'`];
    if (query.userId) conditions.push(`"userId" = '${query.userId}'`);
    if (query.provider) conditions.push(`"provider" = '${query.provider}'`);

    const whereClause = conditions.join(" AND ");
    const truncExpr = query.period === "all" ? "'year'" : `'${query.period}'`;

    const result = await prisma.$queryRawUnsafe<
      { period: Date; provider: string; model: string; total: bigint; count: bigint }[]
    >(
      `SELECT DATE_TRUNC(${truncExpr}, "createdAt") as period,
              "provider", "model",
              SUM("totalTokens") as total,
              COUNT(*) as count
       FROM "TokenUsageLog"
       WHERE ${whereClause}
       GROUP BY period, "provider", "model"
       ORDER BY period`
    );

    return result;
  });

  app.get("/by-user", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const fromDate = query.from
      ? new Date(query.from)
      : new Date(Date.now() - query.days * 86400000);

    const result = await prisma.$queryRaw<
      { userId: string; email: string; name: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT t."userId", u."email", u."name",
             SUM(t."totalTokens") as total,
             COUNT(*) as count
      FROM "TokenUsageLog" t
      JOIN "User" u ON t."userId" = u."id"
      WHERE t."createdAt" >= ${fromDate}
      GROUP BY t."userId", u."email", u."name"
      ORDER BY total DESC
      LIMIT 50
    `);

    return result;
  });

  app.get("/by-provider", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const fromDate = query.from
      ? new Date(query.from)
      : new Date(Date.now() - query.days * 86400000);

    const result = await prisma.$queryRaw<
      { provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT "provider", "model",
             SUM("totalTokens") as total,
             COUNT(*) as count
      FROM "TokenUsageLog"
      WHERE "createdAt" >= ${fromDate}
      GROUP BY "provider", "model"
      ORDER BY total DESC
    `);

    return result;
  });

  app.get("/detail", async (request) => {
    const query = detailQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.provider) where.provider = query.provider;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      prisma.tokenUsageLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      prisma.tokenUsageLog.count({ where }),
    ]);

    return paginatedResponse(data, total, query.page, query.size);
  });

  app.get("/export", async (request, reply) => {
    const query = detailQuerySchema.parse(request.query);

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.provider) where.provider = query.provider;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const data = await prisma.tokenUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
      include: { user: { select: { email: true, name: true } } },
    });

    const csvHeader = "ID,用户邮箱,用户名称,Provider,模型,请求类型,输入Token,输出Token,总Token,时间\n";
    const csvRows = data.map((r) =>
      [r.id, r.user.email, r.user.name, r.provider, r.model, r.requestType,
       r.inputTokens.toString(), r.outputTokens.toString(), r.totalTokens.toString(),
       r.createdAt.toISOString()].join(",")
    ).join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=token-usage.csv");
    return csvHeader + csvRows;
  });
}
