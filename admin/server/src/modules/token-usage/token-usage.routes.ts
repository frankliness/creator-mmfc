import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";

const summaryQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "all"]).default("day"),
  range: z.enum(["today"]).optional(),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  projectId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const detailQuerySchema = paginationSchema.extend({
  range: z.enum(["today"]).optional(),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  projectId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const BEIJING_TIMEZONE = "Asia/Shanghai";

function getBeijingTodayRange() {
  const now = new Date();
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const fromDate = new Date(
    Date.UTC(
      beijingNow.getUTCFullYear(),
      beijingNow.getUTCMonth(),
      beijingNow.getUTCDate(),
      -8,
      0,
      0,
      0
    )
  );
  const toDate = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
}

function resolveTimeRange(query: z.infer<typeof summaryQuerySchema> | z.infer<typeof detailQuerySchema>) {
  if (query.range === "today") {
    return getBeijingTodayRange();
  }

  const fallbackDays = "days" in query && typeof query.days === "number" ? query.days : 30;
  return {
    fromDate: query.from
      ? new Date(query.from)
      : new Date(Date.now() - fallbackDays * 86400000),
    toDate: query.to ? new Date(query.to) : new Date(),
  };
}

function buildUserEmailFilter(query: z.infer<typeof summaryQuerySchema> | z.infer<typeof detailQuerySchema>, userAlias: string) {
  if (!query.userEmail) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(userAlias)}."email" ILIKE ${`%${query.userEmail}%`}`;
}

function buildUserEmailExistsFilter(query: z.infer<typeof summaryQuerySchema> | z.infer<typeof detailQuerySchema>) {
  if (!query.userEmail) return Prisma.empty;
  return Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM "User" u
      WHERE u."id" = "TokenUsageLog"."userId"
        AND u."email" ILIKE ${`%${query.userEmail}%`}
    )
  `;
}

export async function tokenUsageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/summary", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);
    const periodExpr =
      query.period === "all"
        ? Prisma.sql`DATE_TRUNC('year', "createdAt" AT TIME ZONE ${BEIJING_TIMEZONE})`
        : Prisma.sql`DATE_TRUNC(${query.period}, "createdAt" AT TIME ZONE ${BEIJING_TIMEZONE})`;

    const result = await prisma.$queryRaw<
      { periodKey: string; provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT TO_CHAR(${periodExpr}, 'YYYY-MM-DD"T"HH24:MI:SS') AS "periodKey",
             "provider",
             "model",
             SUM("totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog"
      WHERE "createdAt" >= ${fromDate}
        AND "createdAt" < ${toDate}
        ${query.userId ? Prisma.sql`AND "userId" = ${query.userId}` : Prisma.empty}
        ${buildUserEmailExistsFilter(query)}
        ${query.projectId ? Prisma.sql`AND "projectId" = ${query.projectId}` : Prisma.empty}
        ${query.provider ? Prisma.sql`AND "provider" = ${query.provider}` : Prisma.empty}
        ${query.model ? Prisma.sql`AND "model" = ${query.model}` : Prisma.empty}
      GROUP BY 1, 2, 3
      ORDER BY 1
    `);

    return result;
  });

  app.get("/by-user", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const result = await prisma.$queryRaw<
      { userId: string; email: string; name: string; provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT t."userId",
             u."email",
             u."name",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      JOIN "User" u ON t."userId" = u."id"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        ${query.userId ? Prisma.sql`AND t."userId" = ${query.userId}` : Prisma.empty}
        ${buildUserEmailFilter(query, "u")}
        ${query.projectId ? Prisma.sql`AND t."projectId" = ${query.projectId}` : Prisma.empty}
        ${query.provider ? Prisma.sql`AND t."provider" = ${query.provider}` : Prisma.empty}
        ${query.model ? Prisma.sql`AND t."model" = ${query.model}` : Prisma.empty}
      GROUP BY t."userId", u."email", u."name", t."provider", t."model"
      ORDER BY total DESC
      LIMIT 100
    `);

    return result;
  });

  app.get("/by-provider", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const result = await prisma.$queryRaw<
      { provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT "provider",
             "model",
             SUM("totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog"
      WHERE "createdAt" >= ${fromDate}
        AND "createdAt" < ${toDate}
        ${query.userId ? Prisma.sql`AND "userId" = ${query.userId}` : Prisma.empty}
        ${buildUserEmailExistsFilter(query)}
        ${query.projectId ? Prisma.sql`AND "projectId" = ${query.projectId}` : Prisma.empty}
        ${query.provider ? Prisma.sql`AND "provider" = ${query.provider}` : Prisma.empty}
        ${query.model ? Prisma.sql`AND "model" = ${query.model}` : Prisma.empty}
      GROUP BY "provider", "model"
      ORDER BY total DESC
    `);

    return result;
  });

  app.get("/detail", async (request) => {
    const query = detailQuerySchema.parse(request.query);
    const { skip, take } = paginate(query.page, query.size);
    const { fromDate, toDate } = resolveTimeRange(query);

    const where: Prisma.TokenUsageLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.userEmail) where.user = { email: { contains: query.userEmail, mode: "insensitive" } };
    if (query.projectId) where.projectId = query.projectId;
    if (query.provider) where.provider = query.provider;
    if (query.model) where.model = query.model;
    if (query.from || query.to || query.range === "today") {
      where.createdAt = { gte: fromDate, lt: toDate };
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
    const { fromDate, toDate } = resolveTimeRange(query);

    const where: Prisma.TokenUsageLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.userEmail) where.user = { email: { contains: query.userEmail, mode: "insensitive" } };
    if (query.projectId) where.projectId = query.projectId;
    if (query.provider) where.provider = query.provider;
    if (query.model) where.model = query.model;
    if (query.from || query.to || query.range === "today") {
      where.createdAt = { gte: fromDate, lt: toDate };
    }

    const data = await prisma.tokenUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
      include: { user: { select: { email: true, name: true } } },
    });

    const csvHeader = "ID,用户邮箱,用户名称,Provider,模型,请求类型,输入Token,输出Token,总Token,时间\n";
    const csvRows = data
      .map((r) =>
        [
          r.id,
          r.user.email,
          r.user.name,
          r.provider,
          r.model,
          r.requestType,
          r.inputTokens.toString(),
          r.outputTokens.toString(),
          r.totalTokens.toString(),
          r.createdAt.toISOString(),
        ].join(",")
      )
      .join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=token-usage.csv");
    return csvHeader + csvRows;
  });

  app.get("/canvas/by-user", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      { userId: string; email: string; name: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT c."userId", u."email", u."name",
             SUM(c."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "CanvasAiCall" c
      JOIN "User" u ON u."id" = c."userId"
      WHERE c."createdAt" >= ${fromDate} AND c."createdAt" < ${toDate}
      GROUP BY c."userId", u."email", u."name"
      ORDER BY total DESC
      LIMIT 50
    `);
    return rows;
  });

  app.get("/canvas/by-project", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      { projectId: string | null; projectName: string | null; userEmail: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT c."projectId",
             COALESCE(p."name", '(未绑定项目)') AS "projectName",
             u."email" AS "userEmail",
             SUM(c."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "CanvasAiCall" c
      JOIN "User" u ON u."id" = c."userId"
      LEFT JOIN "CanvasProject" p ON p."id" = c."projectId"
      WHERE c."createdAt" >= ${fromDate} AND c."createdAt" < ${toDate}
      GROUP BY c."projectId", p."name", u."email"
      ORDER BY total DESC
      LIMIT 80
    `);
    return rows;
  });

  app.get("/canvas/by-model", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      { model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT c."model",
             SUM(c."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "CanvasAiCall" c
      WHERE c."createdAt" >= ${fromDate} AND c."createdAt" < ${toDate}
      GROUP BY c."model"
      ORDER BY total DESC
      LIMIT 50
    `);
    return rows;
  });
}
