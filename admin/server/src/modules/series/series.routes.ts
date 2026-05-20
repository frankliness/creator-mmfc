/**
 * v1.9.0 Admin Series 路由。
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { requirePermission } from "../../common/guards/permission.js";
import { paginationSchema, paginate, paginatedResponse } from "../../common/pagination.js";
import { createAuditLog } from "../../common/audit.js";
import { z } from "zod";
import {
  createSeriesTransactional,
  adjustTotalBudget,
  addMember,
  updateMember,
  softRemoveMember,
} from "./series.service.js";
import {
  bindOrCreateAssetGroup,
  getAssetGroup,
  searchByteplusAssetGroups,
  unbindAssetGroup,
  type BindAssetGroupInput,
} from "./asset-group.service.js";

const listQuery = paginationSchema.extend({
  ownerId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

const memberInput = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "PRODUCER", "VIEWER"]),
});

const budgetInput = z.object({
  provider: z.string().min(1),
  modelKey: z.string().min(1),
  budgetScope: z.string().min(1),
  metricType: z.enum(["TOKEN", "SUCCESS_COUNT"]),
  totalBudget: z.union([z.number(), z.string()]).transform((v) => String(v)),
  buffer: z.union([z.number(), z.string()]).optional().transform((v) => v === undefined ? "0" : String(v)),
  isHardCap: z.boolean().optional(),
  allocationMode: z.enum(["BUFFER_THEN_AVERAGE", "AVERAGE", "NONE"]).optional(),
});

const assetGroupInput = z.object({
  mode: z.enum(["bind", "create"]),
  groupId: z.string().optional(),
  groupName: z.string().max(64).optional(),
  description: z.string().optional(),
  projectName: z.string().optional(),
}).optional();

const createSeriesBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  totalEpisodes: z.number().int().min(1).max(200),
  defaultRatio: z.string().optional(),
  defaultResolution: z.string().optional(),
  defaultStyle: z.string().optional(),
  members: z.array(memberInput).default([]),
  resourceBudgets: z.array(budgetInput).default([]),
  /** v2.0.0：可选 Asset Group 配置。未提供则 Series 创建后无绑定，Admin 可后续绑定 */
  assetGroup: assetGroupInput,
});

const bindAssetGroupBody = z.object({
  mode: z.enum(["bind", "create"]),
  groupId: z.string().optional(),
  groupName: z.string().max(64).optional(),
  description: z.string().optional(),
  projectName: z.string().optional(),
});

const updateSeriesBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "LOCKED", "ARCHIVED"]).optional(),
});

const addMemberBody = memberInput;
const updateMemberBody = z.object({
  role: z.enum(["OWNER", "PRODUCER", "VIEWER"]).optional(),
  status: z.enum(["ACTIVE", "REMOVED"]).optional(),
});

const adjustBudgetBody = z.object({
  delta: z.union([z.number(), z.string()]).transform((v) => BigInt(String(v))),
  reason: z.string().optional(),
});

const updateBudgetBody = z.object({
  totalBudget: z.union([z.number(), z.string()]).optional().transform((v) => v === undefined ? undefined : BigInt(String(v))),
  unallocatedBudget: z.union([z.number(), z.string()]).optional().transform((v) => v === undefined ? undefined : BigInt(String(v))),
  status: z.enum(["ACTIVE", "LOCKED", "OVERRUN", "EXHAUSTED", "ARCHIVED"]).optional(),
  isHardCap: z.boolean().optional(),
});

// Helper: BigInt-safe JSON
function serializeBudget(b: {
  id: string; seriesId: string; provider: string; modelKey: string; budgetScope: string; metricType: string;
  totalBudget: bigint; committedUsage: bigint; reservedUsage: bigint; unallocatedBudget: bigint;
  isHardCap: boolean; status: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...b,
    totalBudget: b.totalBudget.toString(),
    committedUsage: b.committedUsage.toString(),
    reservedUsage: b.reservedUsage.toString(),
    unallocatedBudget: b.unallocatedBudget.toString(),
    available: (b.totalBudget - b.committedUsage - b.reservedUsage).toString(),
  };
}

export async function seriesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requirePermission("series", "read"));

  // === 列表 ===
  app.get("/", async (request) => {
    const q = listQuery.parse(request.query);
    const { skip, take } = paginate(q.page, q.size);
    const where: Record<string, unknown> = {};
    if (q.ownerId) where.ownerId = q.ownerId;
    if (q.status) where.status = q.status;
    if (q.search) where.name = { contains: q.search, mode: "insensitive" };

    const [rows, total] = await Promise.all([
      prisma.series.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.series.count({ where }),
    ]);
    const seriesIds = rows.map((r) => r.id);
    const [episodeCounts, memberCounts] = await Promise.all([
      seriesIds.length
        ? prisma.project.groupBy({ by: ["seriesId"], where: { seriesId: { in: seriesIds } }, _count: { id: true } })
        : Promise.resolve([]),
      seriesIds.length
        ? prisma.projectMember.groupBy({ by: ["seriesId"], where: { seriesId: { in: seriesIds }, status: "ACTIVE" }, _count: { id: true } })
        : Promise.resolve([]),
    ]);
    const eMap = new Map(episodeCounts.map((e) => [e.seriesId, e._count.id]));
    const mMap = new Map(memberCounts.map((e) => [e.seriesId, e._count.id]));
    const ownerIds = rows.map((r) => r.ownerId).filter(Boolean) as string[];
    const owners = ownerIds.length
      ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
      : [];
    const ownerMap = new Map(owners.map((o) => [o.id, o]));

    return paginatedResponse(
      rows.map((r) => ({
        ...r,
        owner: r.ownerId ? ownerMap.get(r.ownerId) ?? null : null,
        episodeCount: eMap.get(r.id) ?? 0,
        memberCount: mMap.get(r.id) ?? 0,
      })),
      total, q.page, q.size,
    );
  });

  // === 详情 ===
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });

    const [members, projects, budgets, recentEvents, allocations, assetGroup] = await Promise.all([
      prisma.projectMember.findMany({
        where: { seriesId: id, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      }),
      prisma.project.findMany({
        where: { seriesId: id },
        orderBy: { episodeNumber: "asc" },
        select: {
          id: true, name: true, status: true, episodeNumber: true, episodeTitle: true,
          lockedReason: true, ratio: true, resolution: true, createdAt: true, updatedAt: true,
          _count: { select: { storyboards: true } },
        },
      }),
      prisma.seriesResourceBudget.findMany({
        where: { seriesId: id },
        orderBy: [{ budgetScope: "asc" }, { modelKey: "asc" }],
      }),
      prisma.budgetEvent.findMany({
        where: { seriesId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.projectResourceAllocation.findMany({ where: { seriesId: id } }),
      prisma.seriesAssetGroup.findUnique({ where: { seriesId: id } }),
    ]);

    const allocByBudget = new Map<string, typeof allocations>();
    for (const a of allocations) {
      const arr = allocByBudget.get(a.seriesBudgetId) ?? [];
      arr.push(a);
      allocByBudget.set(a.seriesBudgetId, arr);
    }

    const memberUserIds = members.map((m) => m.userId);
    const memberUsers = memberUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: memberUserIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = new Map(memberUsers.map((u) => [u.id, u]));
    const owner = series.ownerId ? await prisma.user.findUnique({ where: { id: series.ownerId }, select: { id: true, name: true, email: true } }) : null;

    return {
      ...series,
      owner,
      members: members.map((m) => ({ ...m, user: userMap.get(m.userId) ?? null })),
      projects,
      budgets: budgets.map((b) => ({
        ...serializeBudget(b),
        allocations: (allocByBudget.get(b.id) ?? []).map((a) => ({
          projectId: a.projectId,
          allocatedBudget: a.allocatedBudget.toString(),
          committedUsage: a.committedUsage.toString(),
          reservedUsage: a.reservedUsage.toString(),
        })),
      })),
      recentEvents: recentEvents.map((e) => ({
        ...e,
        amount: e.amount.toString(),
        beforeBudget: e.beforeBudget?.toString() ?? null,
        afterBudget: e.afterBudget?.toString() ?? null,
        beforeUnallocated: e.beforeUnallocated?.toString() ?? null,
        afterUnallocated: e.afterUnallocated?.toString() ?? null,
      })),
      assetGroup,
    };
  });

  // === 创建 ===
  app.post("/", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const body = createSeriesBody.parse(request.body);
    const admin = request.user as { id: string; role: "ADMIN" | "OPERATOR" | "SUPER_ADMIN" };

    // 校验成员 / owner 存在
    const userIds = Array.from(new Set([
      ...(body.ownerId ? [body.ownerId] : []),
      ...body.members.map((m) => m.userId),
    ]));
    if (userIds.length > 0) {
      const found = await prisma.user.count({ where: { id: { in: userIds } } });
      if (found !== userIds.length) {
        return reply.code(400).send({ error: "存在无效的成员 userId" });
      }
    }
    // ownerId 必须出现在 members 里且 role=OWNER（友好校验）
    if (body.ownerId && !body.members.some((m) => m.userId === body.ownerId && m.role === "OWNER")) {
      body.members.push({ userId: body.ownerId, role: "OWNER" });
    }

    const result = await createSeriesTransactional(
      {
        name: body.name,
        description: body.description ?? null,
        ownerId: body.ownerId ?? null,
        totalEpisodes: body.totalEpisodes,
        defaultRatio: body.defaultRatio,
        defaultResolution: body.defaultResolution,
        defaultStyle: body.defaultStyle,
        members: body.members,
        resourceBudgets: body.resourceBudgets.map((b) => ({
          ...b,
          totalBudget: b.totalBudget,
          buffer: b.buffer,
        })),
      },
      admin,
    );

    // v2.0.0：DB 事务外异步创建 / 绑定 Asset Group。失败时 Series 已建好，落 FAILED 状态
    let assetGroup: Awaited<ReturnType<typeof bindOrCreateAssetGroup>> | null = null;
    if (body.assetGroup) {
      try {
        assetGroup = await bindOrCreateAssetGroup(
          result.series.id,
          body.assetGroup as BindAssetGroupInput,
          admin.id,
        );
      } catch (e) {
        // bindOrCreateAssetGroup 内部已捕获 BytePlus 错误。剩下能抛出来的是参数级错误（如缺 groupId）
        request.log.warn({ err: e }, "Series 创建后 bindOrCreateAssetGroup 抛错");
      }
    }

    await createAuditLog({
      adminId: admin.id,
      action: "series.create",
      targetType: "Series",
      targetId: result.series.id,
      after: {
        name: result.series.name,
        episodes: result.projects.length,
        budgets: result.budgets.length,
        assetGroup: assetGroup ? { id: assetGroup.id, status: assetGroup.status, groupId: assetGroup.groupId } : null,
      },
      ip: request.ip,
    });

    return reply.code(201).send({
      id: result.series.id,
      name: result.series.name,
      episodes: result.projects.length,
      budgets: result.budgets.length,
      assetGroup: assetGroup
        ? {
            id: assetGroup.id,
            status: assetGroup.status,
            groupId: assetGroup.groupId,
            groupName: assetGroup.groupName,
            error: assetGroup.error,
          }
        : null,
    });
  });

  // === Asset Group ===

  // 查询 Series 当前绑定
  app.get("/:id/asset-group", async (request, reply) => {
    const { id } = request.params as { id: string };
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const row = await getAssetGroup(id);
    return row;
  });

  // 创建 / 绑定 / 重试 / 改绑：复用同一接口（upsert 语义）
  app.post("/:id/asset-group", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = bindAssetGroupBody.parse(request.body);
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const admin = request.user as { id: string };
    const before = await getAssetGroup(id);
    let row;
    try {
      row = await bindOrCreateAssetGroup(id, body as BindAssetGroupInput, admin.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Asset Group 绑定失败";
      return reply.code(400).send({ error: msg });
    }
    await createAuditLog({
      adminId: admin.id,
      action: before ? "series.asset_group.rebind" : "series.asset_group.create",
      targetType: "SeriesAssetGroup",
      targetId: row.id,
      before: before
        ? { groupId: before.groupId, groupName: before.groupName, status: before.status }
        : undefined,
      after: { mode: body.mode, groupId: row.groupId, groupName: row.groupName, status: row.status, error: row.error },
      ip: request.ip,
    });
    return row;
  });

  // 解绑（保留行，status=UNBOUND）
  app.delete("/:id/asset-group", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const admin = request.user as { id: string };
    const before = await getAssetGroup(id);
    if (!before) return reply.code(404).send({ error: "未绑定 Asset Group" });
    const after = await unbindAssetGroup(id);
    await createAuditLog({
      adminId: admin.id,
      action: "series.asset_group.unbind",
      targetType: "SeriesAssetGroup",
      targetId: before.id,
      before: { groupId: before.groupId, status: before.status },
      after: { groupId: null, status: after?.status },
      ip: request.ip,
    });
    return { message: "已解绑" };
  });

  // 查询 BytePlus 账号下的 Asset Group 列表（Admin 选择已有 Group 时使用）
  app.get("/byteplus/asset-groups", async (request, reply) => {
    const q = z.object({
      keyword: z.string().optional(),
      projectName: z.string().optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      pageToken: z.string().optional(),
    }).parse(request.query);
    try {
      const result = await searchByteplusAssetGroups(q);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "查询 BytePlus Asset Group 失败";
      return reply.code(502).send({ error: msg });
    }
  });

  // === 修改基础信息 ===
  app.patch("/:id", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateSeriesBody.parse(request.body);
    const before = await prisma.series.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "Series 不存在" });
    const admin = request.user as { id: string };

    // 切换 ownerId 时，同步 ProjectMember：新 owner 升为 OWNER，原 owner（如果还在）降为 PRODUCER
    const ownerChanged = body.ownerId !== undefined && body.ownerId !== before.ownerId;
    if (ownerChanged && body.ownerId) {
      const user = await prisma.user.findUnique({ where: { id: body.ownerId } });
      if (!user) return reply.code(400).send({ error: "用户不存在" });
    }
    const after = await prisma.$transaction(async (tx) => {
      if (ownerChanged) {
        if (body.ownerId) {
          await tx.projectMember.updateMany({
            where: { seriesId: id, role: "OWNER", status: "ACTIVE", userId: { not: body.ownerId } },
            data: { role: "PRODUCER" },
          });
          await tx.projectMember.upsert({
            where: { seriesId_userId: { seriesId: id, userId: body.ownerId } },
            update: { role: "OWNER", status: "ACTIVE", createdBy: admin.id },
            create: { seriesId: id, userId: body.ownerId, role: "OWNER", status: "ACTIVE", createdBy: admin.id },
          });
        } else if (before.ownerId) {
          await tx.projectMember.updateMany({
            where: { seriesId: id, userId: before.ownerId, role: "OWNER", status: "ACTIVE" },
            data: { role: "PRODUCER" },
          });
        }
      }
      return tx.series.update({ where: { id }, data: body });
    });
    await createAuditLog({
      adminId: admin.id,
      action: "series.update",
      targetType: "Series",
      targetId: id,
      before,
      after,
      ip: request.ip,
    });
    return after;
  });

  // === 成员 ===
  app.post("/:id/members", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = addMemberBody.parse(request.body);
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) return reply.code(400).send({ error: "用户不存在" });
    const admin = request.user as { id: string };
    const m = await addMember(id, body.userId, body.role, admin);
    await createAuditLog({
      adminId: admin.id,
      action: "series.member.add",
      targetType: "ProjectMember",
      targetId: m.id,
      after: { seriesId: id, userId: body.userId, role: body.role },
      ip: request.ip,
    });
    return m;
  });

  app.patch("/:id/members/:memberId", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { memberId } = request.params as { id: string; memberId: string };
    const body = updateMemberBody.parse(request.body);
    const before = await prisma.projectMember.findUnique({ where: { id: memberId } });
    if (!before) return reply.code(404).send({ error: "成员不存在" });
    const after = await updateMember(memberId, body);
    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "series.member.update",
      targetType: "ProjectMember",
      targetId: memberId,
      before, after,
      ip: request.ip,
    });
    return after;
  });

  app.delete("/:id/members/:memberId", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { memberId } = request.params as { id: string; memberId: string };
    const before = await prisma.projectMember.findUnique({ where: { id: memberId } });
    if (!before) return reply.code(404).send({ error: "成员不存在" });
    const admin = request.user as { id: string };
    const after = await softRemoveMember(memberId, admin);
    await createAuditLog({
      adminId: admin.id,
      action: "series.member.remove",
      targetType: "ProjectMember",
      targetId: memberId,
      before, after,
      ip: request.ip,
    });
    return { message: "已移除" };
  });

  // === 预算 ===
  app.get("/:id/resource-budgets", async (request, reply) => {
    const { id } = request.params as { id: string };
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const budgets = await prisma.seriesResourceBudget.findMany({
      where: { seriesId: id },
      orderBy: [{ budgetScope: "asc" }, { modelKey: "asc" }],
    });
    return budgets.map(serializeBudget);
  });

  app.post("/:id/resource-budgets", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = budgetInput.parse(request.body);
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const total = BigInt(body.totalBudget);
    const buffer = BigInt(body.buffer ?? "0");
    const admin = request.user as { id: string };
    const created = await prisma.$transaction(async (tx) => {
      const b = await tx.seriesResourceBudget.create({
        data: {
          seriesId: id,
          provider: body.provider,
          modelKey: body.modelKey,
          budgetScope: body.budgetScope,
          metricType: body.metricType,
          totalBudget: total,
          unallocatedBudget: buffer,
          isHardCap: body.isHardCap ?? true,
          createdBy: admin.id,
        },
      });
      await tx.budgetEvent.create({
        data: {
          seriesId: id,
          seriesBudgetId: b.id,
          type: "SERIES_BUDGET_CREATE",
          metricType: body.metricType,
          amount: total,
          beforeBudget: BigInt(0),
          afterBudget: total,
          beforeUnallocated: BigInt(0),
          afterUnallocated: buffer,
          operatorId: admin.id,
          operatorRole: "ADMIN",
          reason: "新增预算项",
        },
      });
      return b;
    });
    await createAuditLog({
      adminId: admin.id,
      action: "series.budget.create",
      targetType: "SeriesResourceBudget",
      targetId: created.id,
      after: { ...created, totalBudget: created.totalBudget.toString(), unallocatedBudget: created.unallocatedBudget.toString() },
      ip: request.ip,
    });
    return serializeBudget(created);
  });

  app.patch("/:id/resource-budgets/:budgetId", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { budgetId } = request.params as { id: string; budgetId: string };
    const body = updateBudgetBody.parse(request.body);
    const before = await prisma.seriesResourceBudget.findUnique({ where: { id: budgetId } });
    if (!before) return reply.code(404).send({ error: "预算项不存在" });
    if (body.totalBudget !== undefined) {
      const minRequired = before.committedUsage + before.reservedUsage;
      if (body.totalBudget < minRequired) {
        return reply.code(400).send({ error: `总预算不能低于已用+预扣 ${minRequired}` });
      }
    }
    const after = await prisma.seriesResourceBudget.update({
      where: { id: budgetId },
      data: {
        totalBudget: body.totalBudget,
        unallocatedBudget: body.unallocatedBudget,
        status: body.status,
        isHardCap: body.isHardCap,
      },
    });
    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "series.budget.update",
      targetType: "SeriesResourceBudget",
      targetId: budgetId,
      before: { ...before, totalBudget: before.totalBudget.toString(), unallocatedBudget: before.unallocatedBudget.toString() },
      after: { ...after, totalBudget: after.totalBudget.toString(), unallocatedBudget: after.unallocatedBudget.toString() },
      ip: request.ip,
    });
    return serializeBudget(after);
  });

  app.post("/:id/resource-budgets/:budgetId/adjust", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { budgetId } = request.params as { id: string; budgetId: string };
    const body = adjustBudgetBody.parse(request.body);
    const admin = request.user as { id: string };
    try {
      const after = await adjustTotalBudget(budgetId, body.delta, admin, body.reason);
      await createAuditLog({
        adminId: admin.id,
        action: "series.budget.adjust",
        targetType: "SeriesResourceBudget",
        targetId: budgetId,
        after: { delta: body.delta.toString(), totalBudget: after.totalBudget.toString() },
        ip: request.ip,
      });
      return serializeBudget(after);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "调整失败";
      return reply.code(400).send({ error: msg });
    }
  });

  // === 分配现有项目 ===
  app.post("/:id/episodes/assign", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id: seriesId } = request.params as { id: string };
    const body = z.object({
      projectId: z.string().min(1),
      episodeNumber: z.number().int().min(1).optional(),
      episodeTitle: z.string().optional(),
      allocatedTokens: z.union([z.number(), z.string()]).optional()
        .transform(v => v !== undefined && v !== "" ? BigInt(String(v)) : null),
    }).parse(request.body);

    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });

    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) return reply.code(404).send({ error: "项目不存在" });
    if (project.seriesId) return reply.code(400).send({ error: "该项目已属于某个 Series，不可重复分配" });

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({
        where: { id: body.projectId },
        data: {
          seriesId,
          episodeNumber: body.episodeNumber ?? null,
          episodeTitle: body.episodeTitle ?? null,
        },
      });

      if (body.allocatedTokens && body.allocatedTokens > 0n) {
        const tokenBudgets = await tx.seriesResourceBudget.findMany({
          where: { seriesId, metricType: "TOKEN" },
        });
        for (const budget of tokenBudgets) {
          if (budget.unallocatedBudget < body.allocatedTokens!) {
            throw new Error(`预算 ${budget.modelKey} buffer 不足：可用 ${budget.unallocatedBudget}，需要 ${body.allocatedTokens}`);
          }
          await tx.seriesResourceBudget.update({
            where: { id: budget.id },
            data: { unallocatedBudget: { decrement: body.allocatedTokens! } },
          });
          await tx.projectResourceAllocation.upsert({
            where: { seriesBudgetId_projectId: { seriesBudgetId: budget.id, projectId: body.projectId } },
            create: {
              seriesBudgetId: budget.id,
              seriesId,
              projectId: body.projectId,
              allocatedBudget: body.allocatedTokens!,
            },
            update: {
              allocatedBudget: { increment: body.allocatedTokens! },
            },
          });
          await tx.budgetEvent.create({
            data: {
              seriesId,
              seriesBudgetId: budget.id,
              projectId: body.projectId,
              type: "BUFFER_ALLOCATE",
              metricType: "TOKEN",
              amount: body.allocatedTokens!,
              reason: `Admin 分配项目 ${body.projectId} 加入 Series`,
              metadata: {},
            },
          });
        }
      }

      return p;
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "series.assign_project",
      targetType: "Project",
      targetId: body.projectId,
      after: { seriesId, projectId: body.projectId },
      ip: request.ip,
    });
    return reply.code(200).send({ project: updated });
  });

  // === 均分 Buffer ===
  app.post("/:id/resource-budgets/:budgetId/distribute", { preHandler: [requirePermission("series", "write")] }, async (request, reply) => {
    const { id: seriesId, budgetId } = request.params as { id: string; budgetId: string };

    const budget = await prisma.seriesResourceBudget.findUnique({ where: { id: budgetId } });
    if (!budget || budget.seriesId !== seriesId) return reply.code(404).send({ error: "预算不存在" });

    const projects = await prisma.project.findMany({ where: { seriesId } });
    const existingAllocs = await prisma.projectResourceAllocation.findMany({
      where: { seriesBudgetId: budgetId },
    });
    const allocatedProjectIds = new Set(existingAllocs.map((a) => a.projectId));
    const unallocatedProjects = projects.filter((p) => !allocatedProjectIds.has(p.id));

    if (unallocatedProjects.length === 0) return reply.code(400).send({ error: "所有集数已有分配，无需分配" });

    const perEpisode = budget.unallocatedBudget / BigInt(unallocatedProjects.length);
    if (perEpisode <= 0n) return reply.code(400).send({ error: "Buffer 不足，无法分配" });

    await prisma.$transaction(async (tx) => {
      for (const p of unallocatedProjects) {
        await tx.projectResourceAllocation.create({
          data: {
            seriesBudgetId: budgetId,
            seriesId,
            projectId: p.id,
            allocatedBudget: perEpisode,
          },
        });
      }
      await tx.seriesResourceBudget.update({
        where: { id: budgetId },
        data: { unallocatedBudget: { decrement: perEpisode * BigInt(unallocatedProjects.length) } },
      });
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "series.distribute_budget",
      targetType: "SeriesResourceBudget",
      targetId: budgetId,
      after: { seriesId, budgetId, perEpisode: perEpisode.toString() },
      ip: request.ip,
    });
    return reply.send({ distributed: unallocatedProjects.length, perEpisode: perEpisode.toString() });
  });

  // === 日志 ===
  app.get("/:id/budget-events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = paginationSchema.parse(request.query);
    const { skip, take } = paginate(q.page, q.size);
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const [rows, total] = await Promise.all([
      prisma.budgetEvent.findMany({
        where: { seriesId: id },
        orderBy: { createdAt: "desc" },
        skip, take,
      }),
      prisma.budgetEvent.count({ where: { seriesId: id } }),
    ]);
    return paginatedResponse(
      rows.map((e) => ({
        ...e,
        amount: e.amount.toString(),
        beforeBudget: e.beforeBudget?.toString() ?? null,
        afterBudget: e.afterBudget?.toString() ?? null,
        beforeUnallocated: e.beforeUnallocated?.toString() ?? null,
        afterUnallocated: e.afterUnallocated?.toString() ?? null,
      })),
      total, q.page, q.size,
    );
  });

  app.get("/:id/usage-logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = paginationSchema.extend({
      budgetScope: z.string().optional(),
      metricType: z.string().optional(),
      status: z.string().optional(),
    }).parse(request.query);
    const { skip, take } = paginate(q.page, q.size);
    const series = await prisma.series.findUnique({ where: { id } });
    if (!series) return reply.code(404).send({ error: "Series 不存在" });
    const where: Record<string, unknown> = { seriesId: id };
    if (q.budgetScope) where.budgetScope = q.budgetScope;
    if (q.metricType) where.metricType = q.metricType;
    if (q.status) where.status = q.status;
    const [rows, total] = await Promise.all([
      prisma.tokenUsageLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.tokenUsageLog.count({ where }),
    ]);
    return paginatedResponse(
      rows.map((r) => ({
        ...r,
        inputTokens: r.inputTokens.toString(),
        outputTokens: r.outputTokens.toString(),
        totalTokens: r.totalTokens.toString(),
        estimateTokens: r.estimateTokens.toString(),
        actualTokens: r.actualTokens.toString(),
        reservedAmount: r.reservedAmount.toString(),
        committedAmount: r.committedAmount.toString(),
      })),
      total, q.page, q.size,
    );
  });
}
