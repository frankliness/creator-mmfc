import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";
import { Prisma } from "@prisma/client";

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/overview", async () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [
      totalUsers,
      todayUsers,
      activeUsers,
      totalTasks,
      submittedTasks,
      runningTasks,
      failedTasks,
      totalProjects,
      tokenSum,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.tokenUsageLog.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        distinct: ["userId"],
        select: { userId: true },
      }).then((r) => r.length),
      prisma.generationTask.count(),
      prisma.generationTask.count({ where: { status: "SUBMITTED" } }),
      prisma.generationTask.count({ where: { status: "RUNNING" } }),
      prisma.generationTask.count({ where: { status: "FAILED" } }),
      prisma.project.count(),
      prisma.tokenUsageLog.aggregate({ _sum: { totalTokens: true } }),
    ]);

    return {
      users: { total: totalUsers, today: todayUsers, active: activeUsers },
      tasks: { total: totalTasks, submitted: submittedTasks, running: runningTasks, failed: failedTasks },
      projects: { total: totalProjects },
      tokens: { total: tokenSum._sum.totalTokens?.toString() ?? "0" },
    };
  });

  app.get("/trends", async (request) => {
    const { days } = z.object({ days: z.coerce.number().default(30) }).parse(request.query);
    const fromDate = new Date(Date.now() - days * 86400000);

    const result = await prisma.$queryRaw<
      { period: Date; provider: string; total: bigint; count: bigint }[]
    >(Prisma.sql`
      SELECT DATE_TRUNC('day', "createdAt") as period,
             "provider",
             SUM("totalTokens") as total,
             COUNT(*) as count
      FROM "TokenUsageLog"
      WHERE "createdAt" >= ${fromDate}
      GROUP BY period, "provider"
      ORDER BY period
    `);

    return result;
  });

  app.get("/task-stats", async () => {
    const result = await prisma.generationTask.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    return result.map((r) => ({ status: r.status, count: r._count.id }));
  });
}
