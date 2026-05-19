import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { requirePermission } from "../../common/guards/permission.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";

const summaryQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "all"]).default("day"),
  range: z.enum(["today"]).optional(),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  projectId: z.string().optional(),
  seriesId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const detailQuerySchema = paginationSchema.extend({
  days: z.coerce.number().int().min(1).max(365).default(30),
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

function escapeCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

/**
 * 报表口径统一过滤：只统计"真实 token 消耗"行
 * - status='FINALIZED'：排除 seedance RESERVED（进行中）/ RELEASED（失败放走）的占位
 * - metricType IS NULL OR ='TOKEN'：排除 canvas SUCCESS_COUNT 这类按"次数"配额的占位行
 * 老数据 status 默认 'FINALIZED'、metricType 为 NULL，自动通过。
 *
 * 调用方传别名前缀（如 `t` → `t.`），或传 `"TokenUsageLog"` → 双引号包裹的表名。
 */
function finalizedFilter(prefix: string) {
  const p = Prisma.raw(prefix);
  return Prisma.sql`
    AND ${p}."status" = 'FINALIZED'
    AND (${p}."metricType" IS NULL OR ${p}."metricType" = 'TOKEN')
  `;
}

export async function tokenUsageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requirePermission("tokenUsage", "read"));

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
        ${finalizedFilter(`"TokenUsageLog"`)}
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
        ${finalizedFilter("t")}
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
        ${finalizedFilter(`"TokenUsageLog"`)}
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
    where.createdAt = { gte: fromDate, lt: toDate };
    where.status = "FINALIZED";
    where.OR = [{ metricType: null }, { metricType: "TOKEN" }];

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
    where.createdAt = { gte: fromDate, lt: toDate };
    where.status = "FINALIZED";
    where.OR = [{ metricType: null }, { metricType: "TOKEN" }];

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
        ]
          .map(escapeCsvCell)
          .join(",")
      )
      .join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=token-usage.csv");
    return `\uFEFF${csvHeader}${csvRows}`;
  });

  app.get("/export/by-user", async (request, reply) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const data = await prisma.$queryRaw<
      { email: string; name: string | null; provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT u."email",
             u."name",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      JOIN "User" u ON t."userId" = u."id"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        ${finalizedFilter("t")}
        ${query.userId ? Prisma.sql`AND t."userId" = ${query.userId}` : Prisma.empty}
        ${buildUserEmailFilter(query, "u")}
        ${query.projectId ? Prisma.sql`AND t."projectId" = ${query.projectId}` : Prisma.empty}
        ${query.provider ? Prisma.sql`AND t."provider" = ${query.provider}` : Prisma.empty}
        ${query.model ? Prisma.sql`AND t."model" = ${query.model}` : Prisma.empty}
      GROUP BY t."userId", u."email", u."name", t."provider", t."model"
      ORDER BY total DESC
    `);

    const csvHeader = "排名,用户邮箱,用户名称,Provider,模型,总Token,请求次数\n";
    const csvRows = data
      .map((r, index) =>
        [
          (index + 1).toString(),
          r.email,
          r.name,
          r.provider,
          r.model,
          r.total.toString(),
          r.count.toString(),
        ]
          .map(escapeCsvCell)
          .join(",")
      )
      .join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=token-usage-by-user.csv");
    return `\uFEFF${csvHeader}${csvRows}`;
  });

  /** 以 Project（集数）为维度 — 按 (project × user × provider × model) 展开 */
  app.get("/by-project", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      { projectId: string; projectName: string | null; userEmail: string; userName: string | null; seriesName: string | null; provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT t."projectId",
             p."name" AS "projectName",
             u."email" AS "userEmail",
             u."name" AS "userName",
             s."name" AS "seriesName",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      LEFT JOIN "Project" p ON p."id" = t."projectId"
      LEFT JOIN "User" u ON u."id" = t."userId"
      LEFT JOIN "Series" s ON s."id" = p."seriesId"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."projectId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.projectId ? Prisma.sql`AND t."projectId" = ${query.projectId}` : Prisma.empty}
        ${buildUserEmailFilter(query, "u")}
      GROUP BY t."projectId", p."name", u."email", u."name", s."name", t."provider", t."model"
      ORDER BY total DESC
      LIMIT 100
    `);
    return rows;
  });

  /** 以 Series 为维度（汇总）— 附带 modelBreakdown */
  app.get("/by-series", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      { seriesId: string | null; seriesName: string | null; total: bigint; count: bigint; userCount: bigint; episodeCount: bigint }[]
    >(Prisma.sql`
      SELECT t."seriesId",
             s."name" AS "seriesName",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count,
             COUNT(DISTINCT t."userId")::bigint AS "userCount",
             COUNT(DISTINCT t."projectId")::bigint AS "episodeCount"
      FROM "TokenUsageLog" t
      LEFT JOIN "Series" s ON s."id" = t."seriesId"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."seriesId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.seriesId ? Prisma.sql`AND t."seriesId" = ${query.seriesId}` : Prisma.empty}
      GROUP BY t."seriesId", s."name"
      ORDER BY total DESC
      LIMIT 100
    `);

    const breakdown = await prisma.$queryRaw<
      { seriesId: string; provider: string; model: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT t."seriesId",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."seriesId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.seriesId ? Prisma.sql`AND t."seriesId" = ${query.seriesId}` : Prisma.empty}
      GROUP BY t."seriesId", t."provider", t."model"
      ORDER BY total DESC
    `);

    const breakdownBySeries = new Map<string, { provider: string; model: string; total: bigint; count: bigint }[]>();
    for (const b of breakdown) {
      const list = breakdownBySeries.get(b.seriesId) ?? [];
      list.push({ provider: b.provider, model: b.model, total: b.total, count: b.count });
      breakdownBySeries.set(b.seriesId, list);
    }

    return rows.map((r) => ({
      ...r,
      modelBreakdown: r.seriesId ? breakdownBySeries.get(r.seriesId) ?? [] : [],
    }));
  });

  /**
   * 以 Series 为维度 — 细化到 (集数 × 用户) 的明细
   * 用于 admin 点击某个 series 后查看：哪个集数被哪些用户消耗了多少 token
   */
  app.get("/by-series-breakdown", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const rows = await prisma.$queryRaw<
      {
        seriesId: string;
        seriesName: string | null;
        projectId: string | null;
        episodeNumber: number | null;
        episodeName: string | null;
        userId: string;
        userEmail: string;
        userName: string | null;
        provider: string;
        model: string;
        total: bigint;
        count: bigint;
      }[]
    >(Prisma.sql`
      SELECT t."seriesId",
             s."name" AS "seriesName",
             t."projectId",
             p."episodeNumber" AS "episodeNumber",
             COALESCE(p."episodeTitle", p."name") AS "episodeName",
             t."userId",
             u."email" AS "userEmail",
             u."name" AS "userName",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      LEFT JOIN "Series" s ON s."id" = t."seriesId"
      LEFT JOIN "Project" p ON p."id" = t."projectId"
      LEFT JOIN "User" u ON u."id" = t."userId"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."seriesId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.seriesId ? Prisma.sql`AND t."seriesId" = ${query.seriesId}` : Prisma.empty}
      GROUP BY t."seriesId", s."name", t."projectId", p."episodeNumber", p."episodeTitle", p."name", t."userId", u."email", u."name", t."provider", t."model"
      ORDER BY t."seriesId", p."episodeNumber" NULLS LAST, total DESC
      LIMIT 1000
    `);
    return rows;
  });

  /** 导出「按项目维度」: ① Series×model 汇总 + ② 集数×用户×model 明细，拼接为单 CSV */
  app.get("/export/by-project", async (request, reply) => {
    const query = summaryQuerySchema.parse(request.query);
    const { fromDate, toDate } = resolveTimeRange(query);

    const seriesRows = await prisma.$queryRaw<
      {
        seriesName: string | null;
        seriesId: string;
        provider: string;
        model: string;
        episodeCount: bigint;
        userCount: bigint;
        total: bigint;
        count: bigint;
      }[]
    >(Prisma.sql`
      SELECT s."name" AS "seriesName",
             t."seriesId",
             t."provider",
             t."model",
             COUNT(DISTINCT t."projectId")::bigint AS "episodeCount",
             COUNT(DISTINCT t."userId")::bigint AS "userCount",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      LEFT JOIN "Series" s ON s."id" = t."seriesId"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."seriesId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.seriesId ? Prisma.sql`AND t."seriesId" = ${query.seriesId}` : Prisma.empty}
      GROUP BY s."name", t."seriesId", t."provider", t."model"
      ORDER BY s."name" NULLS LAST, total DESC
    `);

    const breakdownRows = await prisma.$queryRaw<
      {
        seriesName: string | null;
        episodeNumber: number | null;
        episodeName: string | null;
        userEmail: string;
        userName: string | null;
        provider: string;
        model: string;
        total: bigint;
        count: bigint;
      }[]
    >(Prisma.sql`
      SELECT s."name" AS "seriesName",
             p."episodeNumber" AS "episodeNumber",
             COALESCE(p."episodeTitle", p."name") AS "episodeName",
             u."email" AS "userEmail",
             u."name" AS "userName",
             t."provider",
             t."model",
             SUM(t."totalTokens") AS total,
             COUNT(*)::bigint AS count
      FROM "TokenUsageLog" t
      LEFT JOIN "Series" s ON s."id" = t."seriesId"
      LEFT JOIN "Project" p ON p."id" = t."projectId"
      LEFT JOIN "User" u ON u."id" = t."userId"
      WHERE t."createdAt" >= ${fromDate}
        AND t."createdAt" < ${toDate}
        AND t."seriesId" IS NOT NULL
        ${finalizedFilter("t")}
        ${query.seriesId ? Prisma.sql`AND t."seriesId" = ${query.seriesId}` : Prisma.empty}
      GROUP BY s."name", p."episodeNumber", p."episodeTitle", p."name", u."email", u."name", t."provider", t."model"
      ORDER BY s."name" NULLS LAST, p."episodeNumber" NULLS LAST, total DESC
    `);

    const seriesHeader = "Series,Provider,模型,集数数,用户数,总Token,调用次数";
    const seriesCsv = seriesRows
      .map((r) =>
        [
          r.seriesName ?? r.seriesId,
          r.provider,
          r.model,
          r.episodeCount.toString(),
          r.userCount.toString(),
          r.total.toString(),
          r.count.toString(),
        ]
          .map(escapeCsvCell)
          .join(",")
      )
      .join("\n");

    const breakdownHeader = "Series,集数,用户邮箱,用户名,Provider,模型,总Token,调用次数";
    const breakdownCsv = breakdownRows
      .map((r) => {
        const epNum = r.episodeNumber ? `第${r.episodeNumber}集` : "—";
        const ep = r.episodeName ? `${epNum} · ${r.episodeName}` : epNum;
        return [
          r.seriesName ?? "—",
          ep,
          r.userEmail,
          r.userName ?? "",
          r.provider,
          r.model,
          r.total.toString(),
          r.count.toString(),
        ]
          .map(escapeCsvCell)
          .join(",");
      })
      .join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=token-usage-by-project.csv");
    return `﻿==== 按 Series 汇总 ====\n${seriesHeader}\n${seriesCsv}\n\n==== 集数 × 用户 明细 ====\n${breakdownHeader}\n${breakdownCsv}\n`;
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
