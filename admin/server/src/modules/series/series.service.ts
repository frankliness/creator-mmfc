/**
 * v1.9.0 Admin Series 业务层。
 * 全部预算变更落 BudgetEvent；admin 操作通过 routes 层另写 AuditLog。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma.js";

export type CreateSeriesPayload = {
  name: string;
  description?: string | null;
  ownerId?: string | null;
  totalEpisodes: number;
  defaultRatio?: string;
  defaultResolution?: string;
  defaultStyle?: string;
  members: Array<{ userId: string; role: "OWNER" | "PRODUCER" | "VIEWER" }>;
  resourceBudgets: Array<{
    provider: string;
    modelKey: string;
    budgetScope: string;
    metricType: "TOKEN" | "SUCCESS_COUNT";
    totalBudget: number | string | bigint;
    buffer?: number | string | bigint;
    isHardCap?: boolean;
    allocationMode?: "BUFFER_THEN_AVERAGE" | "AVERAGE" | "NONE";
  }>;
};

function toBig(n: number | string | bigint | undefined | null): bigint {
  if (n === undefined || n === null) return BigInt(0);
  if (typeof n === "bigint") return n;
  if (typeof n === "number") return BigInt(Math.trunc(n));
  return BigInt(n);
}

export async function createSeriesTransactional(
  payload: CreateSeriesPayload,
  operator: { id: string; role: "ADMIN" | "OPERATOR" | "SUPER_ADMIN" },
) {
  return prisma.$transaction(async (tx) => {
    // 1) 建 Series
    const series = await tx.series.create({
      data: {
        name: payload.name,
        description: payload.description ?? null,
        ownerId: payload.ownerId ?? null,
        status: "ACTIVE",
        defaultStyle: payload.defaultStyle ?? "",
        defaultRatio: payload.defaultRatio ?? "9:16",
        defaultResolution: payload.defaultResolution ?? "720p",
        defaultSeed: 0,
        createdBy: operator.id,
      },
    });

    // 2) 批量建 Project 集数
    const projects = [];
    for (let i = 1; i <= payload.totalEpisodes; i++) {
      const p = await tx.project.create({
        data: {
          // 集数挂到 Series Owner 名下（若未指定 owner，则挂到操作员，但操作员是 admin，没 User 关联，所以 fallback 到第一个 OWNER member）
          userId:
            payload.ownerId ??
            payload.members.find((m) => m.role === "OWNER")?.userId ??
            payload.members[0]?.userId ??
            "",
          name: `${payload.name} - 第 ${i} 集`,
          script: "",
          fullScript: "",
          assetsJson: [],
          assetDescriptions: [],
          style: payload.defaultStyle ?? "",
          ratio: payload.defaultRatio ?? "9:16",
          resolution: payload.defaultResolution ?? "720p",
          // v1.9.1：每集分配独立随机 seed（项目级 fallback；storyboard 仍可覆盖）
          globalSeed: Math.floor(Math.random() * 2147483647) + 1,
          seriesId: series.id,
          episodeNumber: i,
          episodeTitle: `第 ${i} 集`,
          assigneeId: null,
        },
      });
      projects.push(p);
    }

    // 3) 成员
    for (const m of payload.members) {
      await tx.projectMember.upsert({
        where: { seriesId_userId: { seriesId: series.id, userId: m.userId } },
        update: { role: m.role, status: "ACTIVE", createdBy: operator.id },
        create: {
          seriesId: series.id,
          userId: m.userId,
          role: m.role,
          status: "ACTIVE",
          createdBy: operator.id,
        },
      });
    }

    // 4) 预算池
    const budgets = [];
    for (const b of payload.resourceBudgets) {
      const total = toBig(b.totalBudget);
      const buffer = toBig(b.buffer ?? 0);
      const budget = await tx.seriesResourceBudget.create({
        data: {
          seriesId: series.id,
          provider: b.provider,
          modelKey: b.modelKey,
          budgetScope: b.budgetScope,
          metricType: b.metricType,
          totalBudget: total,
          committedUsage: BigInt(0),
          reservedUsage: BigInt(0),
          unallocatedBudget: buffer,
          isHardCap: b.isHardCap ?? true,
          status: "ACTIVE",
          createdBy: operator.id,
        },
      });
      budgets.push(budget);

      // BudgetEvent SERIES_BUDGET_CREATE
      await tx.budgetEvent.create({
        data: {
          seriesId: series.id,
          seriesBudgetId: budget.id,
          type: "SERIES_BUDGET_CREATE",
          metricType: b.metricType,
          amount: total,
          beforeBudget: BigInt(0),
          afterBudget: total,
          beforeUnallocated: BigInt(0),
          afterUnallocated: buffer,
          operatorId: operator.id,
          operatorRole: "ADMIN",
          reason: "Series 创建",
        },
      });

      // 5) 若为 Seedance video_generation 且启用集数分配，平均分配 totalBudget - buffer
      if (
        b.metricType === "TOKEN" &&
        b.budgetScope === "video_generation" &&
        (b.allocationMode === "AVERAGE" || b.allocationMode === "BUFFER_THEN_AVERAGE")
      ) {
        const allocatable = total - buffer;
        if (allocatable > BigInt(0) && projects.length > 0) {
          const per = allocatable / BigInt(projects.length);
          let remainder = allocatable - per * BigInt(projects.length);
          for (const p of projects) {
            const extra = remainder > BigInt(0) ? BigInt(1) : BigInt(0);
            if (remainder > BigInt(0)) remainder -= BigInt(1);
            const alloc = per + extra;
            await tx.projectResourceAllocation.create({
              data: {
                seriesBudgetId: budget.id,
                seriesId: series.id,
                projectId: p.id,
                allocatedBudget: alloc,
                committedUsage: BigInt(0),
                reservedUsage: BigInt(0),
              },
            });
            await tx.budgetEvent.create({
              data: {
                seriesId: series.id,
                seriesBudgetId: budget.id,
                projectId: p.id,
                type: "PROJECT_ALLOCATE",
                metricType: b.metricType,
                amount: alloc,
                beforeBudget: BigInt(0),
                afterBudget: alloc,
                operatorId: operator.id,
                operatorRole: "ADMIN",
                reason: "Series 创建-集数初始分配",
              },
            });
          }
        }
      }
    }

    return { series, projects, budgets };
  }, { timeout: 30_000 });
}

/**
 * 调整 Series 预算总额。
 *
 * 增（delta > 0）：unallocated += delta；集数 allocation 不变。
 * 减（delta < 0）：
 *   1) 优先从 unallocated 扣
 *   2) 不够则从各集 allocation 的"可回收额度"（allocated - committed - reserved）按比例扣
 *   3) 若可回收总和仍不够，抛 400
 *
 * 不变量：totalBudget = unallocated + Σ allocated（committed/reserved 已计入 allocated）
 */
export async function adjustTotalBudget(
  budgetId: string,
  delta: bigint,
  operator: { id: string; role?: string },
  reason?: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.seriesResourceBudget.findUnique({ where: { id: budgetId } });
    if (!before) throw new Error("Budget not found");

    const newTotal = before.totalBudget + delta;
    const minRequired = before.committedUsage + before.reservedUsage;
    if (newTotal < minRequired) {
      throw new Error(`总预算 ${newTotal} 不能低于已用+预扣 ${minRequired}`);
    }
    if (newTotal < BigInt(0)) throw new Error("总预算不能为负");

    let newUnallocated: bigint;
    const deductions: Array<{ allocationId: string; projectId: string; before: bigint; after: bigint; deduct: bigint }> = [];

    if (delta >= BigInt(0)) {
      // 增：全部进 buffer
      newUnallocated = before.unallocatedBudget + delta;
    } else {
      const absDelta = -delta;
      if (absDelta <= before.unallocatedBudget) {
        // 1) buffer 足够
        newUnallocated = before.unallocatedBudget - absDelta;
      } else {
        // 2) buffer 不够，余额从集数 allocation 按比例扣
        const shortfall = absDelta - before.unallocatedBudget;
        const allocs = await tx.projectResourceAllocation.findMany({
          where: { seriesBudgetId: budgetId },
          orderBy: { createdAt: "asc" },
        });
        const recoverableByAlloc = allocs.map((a) => ({
          alloc: a,
          recoverable: a.allocatedBudget - a.committedUsage - a.reservedUsage,
        }));
        const totalRecoverable = recoverableByAlloc.reduce((sum, x) => sum + (x.recoverable > BigInt(0) ? x.recoverable : BigInt(0)), BigInt(0));

        if (shortfall > totalRecoverable) {
          throw new Error(
            `调整失败：超出 buffer ${shortfall} 单位，但各集合计仅可回收 ${totalRecoverable}（已扣除各集已用+预扣）。请先减小幅度或等待运行中任务完成。`
          );
        }

        // 按比例扣（向下取整 + 余数补给可回收最大的一集）
        let remaining = shortfall;
        const sortedDesc = [...recoverableByAlloc]
          .filter((x) => x.recoverable > BigInt(0))
          .sort((a, b) => (b.recoverable > a.recoverable ? 1 : b.recoverable < a.recoverable ? -1 : 0));

        for (let i = 0; i < sortedDesc.length; i++) {
          const x = sortedDesc[i];
          let deduct: bigint;
          if (i === sortedDesc.length - 1) {
            // 最后一个吃掉所有 remainder（避免 floor 累计误差）
            deduct = remaining;
          } else {
            // floor(recoverable_i / totalRecoverable * shortfall)
            deduct = (x.recoverable * shortfall) / totalRecoverable;
          }
          if (deduct > x.recoverable) deduct = x.recoverable;
          if (deduct <= BigInt(0)) continue;
          const newAllocated = x.alloc.allocatedBudget - deduct;
          await tx.projectResourceAllocation.update({
            where: { id: x.alloc.id },
            data: { allocatedBudget: newAllocated },
          });
          deductions.push({
            allocationId: x.alloc.id,
            projectId: x.alloc.projectId,
            before: x.alloc.allocatedBudget,
            after: newAllocated,
            deduct,
          });
          remaining -= deduct;
          if (remaining <= BigInt(0)) break;
        }

        newUnallocated = BigInt(0);
      }
    }

    const after = await tx.seriesResourceBudget.update({
      where: { id: budgetId },
      data: { totalBudget: newTotal, unallocatedBudget: newUnallocated },
    });

    // 主事件
    await tx.budgetEvent.create({
      data: {
        seriesId: before.seriesId,
        seriesBudgetId: budgetId,
        type: delta >= BigInt(0) ? "ADMIN_ADJUST_INCREASE" : "ADMIN_ADJUST_DECREASE",
        metricType: before.metricType,
        amount: delta >= BigInt(0) ? delta : -delta,
        beforeBudget: before.totalBudget,
        afterBudget: after.totalBudget,
        beforeUnallocated: before.unallocatedBudget,
        afterUnallocated: after.unallocatedBudget,
        operatorId: operator.id,
        operatorRole: "ADMIN",
        reason: reason ?? null,
        metadata: deductions.length
          ? { episodeDeductions: deductions.map((d) => ({ projectId: d.projectId, before: d.before.toString(), after: d.after.toString(), deduct: d.deduct.toString() })) }
          : Prisma.JsonNull,
      },
    });

    // 每集扣减子事件
    for (const d of deductions) {
      await tx.budgetEvent.create({
        data: {
          seriesId: before.seriesId,
          seriesBudgetId: budgetId,
          projectId: d.projectId,
          type: "EPISODE_BUDGET_DEDUCT",
          metricType: before.metricType,
          amount: d.deduct,
          beforeBudget: d.before,
          afterBudget: d.after,
          operatorId: operator.id,
          operatorRole: "ADMIN",
          reason: `因总预算下调，按比例从本集回收 ${d.deduct}`,
        },
      });
    }

    return after;
  });
}

export async function softRemoveMember(
  memberId: string,
  operator: { id: string },
) {
  return prisma.projectMember.update({
    where: { id: memberId },
    data: { status: "REMOVED" },
  });
}

export async function addMember(
  seriesId: string,
  userId: string,
  role: "OWNER" | "PRODUCER" | "VIEWER",
  operator: { id: string },
) {
  return prisma.projectMember.upsert({
    where: { seriesId_userId: { seriesId, userId } },
    update: { role, status: "ACTIVE", createdBy: operator.id },
    create: { seriesId, userId, role, status: "ACTIVE", createdBy: operator.id },
  });
}

export async function updateMember(
  memberId: string,
  patch: { role?: "OWNER" | "PRODUCER" | "VIEWER"; status?: "ACTIVE" | "REMOVED" },
) {
  return prisma.projectMember.update({
    where: { id: memberId },
    data: {
      role: patch.role,
      status: patch.status,
    },
  });
}

// Avoid unused import warning at empty-export time
export const _Prisma = Prisma;
