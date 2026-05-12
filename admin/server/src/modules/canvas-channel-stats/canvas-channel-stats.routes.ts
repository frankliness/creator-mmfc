/**
 * 画布生图渠道统计（v1.5.0）
 *
 * GET /api/admin/canvas-channel-stats?windowMin=60
 *
 * 返回每个 ProviderCredential 在最近 windowMin 分钟内的：
 *   - 成功 / 失败（非限流）/ 限流 计数
 *   - 当前 RUNNING 数 + concurrency 上限 + cooldownUntil
 *
 * 数据源：
 *   - CanvasAiCall.status in (success | failed | rate_limited) GROUP BY credentialId
 *   - CanvasImageTask.status = RUNNING GROUP BY credentialId
 *
 * 用途：admin 渠道并发看板 + 限流根因排查。
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";

const querySchema = z.object({
  /** 时间窗口（分钟），默认 60，最大 1440（24h） */
  windowMin: z.coerce.number().int().min(1).max(1440).default(60),
});

export async function canvasChannelStatsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });
    }
    const since = new Date(Date.now() - parsed.data.windowMin * 60_000);

    const [credentials, callRows, runningRows] = await Promise.all([
      prisma.providerCredential.findMany({
        orderBy: [{ provider: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          provider: true,
          name: true,
          isActive: true,
          concurrency: true,
          cooldownUntil: true,
        },
      }),
      // 按 (credentialId, status) 聚合最近 windowMin 分钟内的画布调用
      prisma.canvasAiCall.groupBy({
        by: ["credentialId", "status"],
        where: {
          createdAt: { gte: since },
          callType: { in: ["canvas_image", "canvas_image_edit"] },
          credentialId: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.canvasImageTask.groupBy({
        by: ["credentialId"],
        where: { status: "RUNNING", credentialId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    type Stat = { success: number; failed: number; rateLimited: number };
    const statsByCred = new Map<string, Stat>();
    for (const row of callRows) {
      if (!row.credentialId) continue;
      const s = statsByCred.get(row.credentialId) ?? { success: 0, failed: 0, rateLimited: 0 };
      const count = row._count._all;
      if (row.status === "success") s.success += count;
      else if (row.status === "rate_limited") s.rateLimited += count;
      else s.failed += count; // 兼容旧值集合，未知 status 计入 failed
      statsByCred.set(row.credentialId, s);
    }

    const runningByCred = new Map<string, number>();
    for (const row of runningRows) {
      if (row.credentialId) runningByCred.set(row.credentialId, row._count._all);
    }

    const now = Date.now();
    return credentials.map((c) => {
      const s = statsByCred.get(c.id) ?? { success: 0, failed: 0, rateLimited: 0 };
      const inCooldown = c.cooldownUntil ? c.cooldownUntil.getTime() > now : false;
      return {
        id: c.id,
        provider: c.provider,
        name: c.name,
        isActive: c.isActive,
        concurrency: c.concurrency,
        cooldownUntil: c.cooldownUntil,
        inCooldown,
        currentRunning: runningByCred.get(c.id) ?? 0,
        success: s.success,
        failed: s.failed,
        rateLimited: s.rateLimited,
      };
    });
  });
}
