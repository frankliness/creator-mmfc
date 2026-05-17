/**
 * v1.9.0 Series 资源预算工具。
 *
 * 所有写操作都必须在 prisma.$transaction(tx) 上下文中调用，调用方负责事务边界与错误回滚。
 * 每次预算变更必须落 BudgetEvent。
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

export const METRIC_TOKEN = "TOKEN" as const;
export const METRIC_SUCCESS_COUNT = "SUCCESS_COUNT" as const;
export type MetricType = typeof METRIC_TOKEN | typeof METRIC_SUCCESS_COUNT;

export const BUDGET_SCOPE_VIDEO = "video_generation" as const;
export const BUDGET_SCOPE_CANVAS_IMAGE = "canvas_image_generation" as const;

/** Canvas 全局预算固定哨兵：不区分模型，整个 Series 共享一条预算行 */
export const CANVAS_GLOBAL_PROVIDER = "canvas" as const;
export const CANVAS_GLOBAL_MODEL_KEY = "*" as const;

export type SeriesResourceBudgetRow = {
  id: string;
  seriesId: string;
  provider: string;
  modelKey: string;
  budgetScope: string;
  metricType: string;
  totalBudget: bigint;
  committedUsage: bigint;
  reservedUsage: bigint;
  unallocatedBudget: bigint;
  isHardCap: boolean;
  status: string;
};

export type BudgetEventCtx = {
  operatorId?: string | null;
  operatorRole?: "ADMIN" | "OWNER" | "PRODUCER" | "SYSTEM";
  reason?: string | null;
  projectId?: string | null;
  metadata?: object | null;
};

/* ============== 读取 ============== */

export async function findBudget(
  client: Tx,
  args: {
    seriesId: string;
    provider: string;
    modelKey: string;
    budgetScope: string;
    metricType: MetricType;
  },
): Promise<SeriesResourceBudgetRow | null> {
  // 1. 精确匹配
  const exact = await client.seriesResourceBudget.findUnique({
    where: {
      seriesId_provider_modelKey_budgetScope_metricType: {
        seriesId: args.seriesId,
        provider: args.provider,
        modelKey: args.modelKey,
        budgetScope: args.budgetScope,
        metricType: args.metricType,
      },
    },
  });
  if (exact) return exact;

  // 2. 通配符回退：modelKey="*" 表示该 provider 所有模型共享预算
  if (args.modelKey !== "*") {
    const wildcard = await client.seriesResourceBudget.findUnique({
      where: {
        seriesId_provider_modelKey_budgetScope_metricType: {
          seriesId: args.seriesId,
          provider: args.provider,
          modelKey: "*",
          budgetScope: args.budgetScope,
          metricType: args.metricType,
        },
      },
    });
    if (wildcard) return wildcard;
  }
  return null;
}

export async function findBudgetById(
  client: Tx,
  id: string,
): Promise<SeriesResourceBudgetRow | null> {
  return client.seriesResourceBudget.findUnique({ where: { id } });
}

export function getAvailableTokens(b: SeriesResourceBudgetRow): bigint {
  return b.totalBudget - b.committedUsage - b.reservedUsage;
}

export function getAvailableSuccessCount(b: SeriesResourceBudgetRow): bigint {
  return b.totalBudget - b.committedUsage;
}

/* ============== BudgetEvent ============== */

export async function writeBudgetEvent(
  client: Tx,
  args: {
    seriesId: string;
    seriesBudgetId?: string | null;
    projectId?: string | null;
    type: string;
    metricType?: string | null;
    amount: bigint;
    beforeBudget?: bigint | null;
    afterBudget?: bigint | null;
    beforeUnallocated?: bigint | null;
    afterUnallocated?: bigint | null;
    operatorId?: string | null;
    operatorRole?: string | null;
    reason?: string | null;
    metadata?: object | null;
  },
) {
  await client.budgetEvent.create({
    data: {
      seriesId: args.seriesId,
      seriesBudgetId: args.seriesBudgetId ?? null,
      projectId: args.projectId ?? null,
      type: args.type,
      metricType: args.metricType ?? null,
      amount: args.amount,
      beforeBudget: args.beforeBudget ?? null,
      afterBudget: args.afterBudget ?? null,
      beforeUnallocated: args.beforeUnallocated ?? null,
      afterUnallocated: args.afterUnallocated ?? null,
      operatorId: args.operatorId ?? null,
      operatorRole: args.operatorRole ?? null,
      reason: args.reason ?? null,
      metadata: (args.metadata as object) ?? undefined,
    },
  });
}

/* ============== 预扣 / 提交 / 释放（Token） ============== */

export async function reserveTokens(
  client: Tx,
  budget: SeriesResourceBudgetRow,
  amount: bigint,
  ctx: BudgetEventCtx & { projectAllocationId?: string | null },
): Promise<SeriesResourceBudgetRow> {
  if (amount <= BigInt(0)) return budget;
  const after = await client.seriesResourceBudget.update({
    where: { id: budget.id },
    data: { reservedUsage: { increment: amount } },
  });
  if (ctx.projectAllocationId) {
    await client.projectResourceAllocation.update({
      where: { id: ctx.projectAllocationId },
      data: { reservedUsage: { increment: amount } },
    });
  }
  await writeBudgetEvent(client, {
    seriesId: budget.seriesId,
    seriesBudgetId: budget.id,
    projectId: ctx.projectId ?? null,
    type: "USAGE_RESERVE",
    metricType: budget.metricType,
    amount,
    beforeBudget: budget.reservedUsage,
    afterBudget: after.reservedUsage,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "PRODUCER",
    reason: ctx.reason ?? null,
    metadata: ctx.metadata ?? null,
  });
  return after;
}

export async function commitTokenUsage(
  client: Tx,
  budget: SeriesResourceBudgetRow,
  reservedAmount: bigint,
  actualAmount: bigint,
  ctx: BudgetEventCtx & { projectAllocationId?: string | null },
): Promise<SeriesResourceBudgetRow> {
  const after = await client.seriesResourceBudget.update({
    where: { id: budget.id },
    data: {
      reservedUsage: { decrement: reservedAmount },
      committedUsage: { increment: actualAmount },
    },
  });
  if (ctx.projectAllocationId) {
    await client.projectResourceAllocation.update({
      where: { id: ctx.projectAllocationId },
      data: {
        reservedUsage: { decrement: reservedAmount },
        committedUsage: { increment: actualAmount },
      },
    });
  }
  // 自动转 OVERRUN
  if (
    after.totalBudget > BigInt(0) &&
    after.committedUsage > after.totalBudget &&
    after.status === "ACTIVE"
  ) {
    await client.seriesResourceBudget.update({
      where: { id: budget.id },
      data: { status: "OVERRUN" },
    });
  }
  await writeBudgetEvent(client, {
    seriesId: budget.seriesId,
    seriesBudgetId: budget.id,
    projectId: ctx.projectId ?? null,
    type: "USAGE_COMMIT",
    metricType: budget.metricType,
    amount: actualAmount,
    beforeBudget: budget.committedUsage,
    afterBudget: after.committedUsage,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "SYSTEM",
    reason: ctx.reason ?? null,
    metadata: { reservedAmount: reservedAmount.toString(), actualAmount: actualAmount.toString(), ...(ctx.metadata ?? {}) },
  });
  return after;
}

export async function releaseTokenUsage(
  client: Tx,
  budget: SeriesResourceBudgetRow,
  reservedAmount: bigint,
  ctx: BudgetEventCtx & { projectAllocationId?: string | null },
): Promise<SeriesResourceBudgetRow> {
  if (reservedAmount <= BigInt(0)) return budget;
  const after = await client.seriesResourceBudget.update({
    where: { id: budget.id },
    data: { reservedUsage: { decrement: reservedAmount } },
  });
  if (ctx.projectAllocationId) {
    await client.projectResourceAllocation.update({
      where: { id: ctx.projectAllocationId },
      data: { reservedUsage: { decrement: reservedAmount } },
    });
  }
  await writeBudgetEvent(client, {
    seriesId: budget.seriesId,
    seriesBudgetId: budget.id,
    projectId: ctx.projectId ?? null,
    type: "USAGE_RELEASE",
    metricType: budget.metricType,
    amount: reservedAmount,
    beforeBudget: budget.reservedUsage,
    afterBudget: after.reservedUsage,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "SYSTEM",
    reason: ctx.reason ?? null,
    metadata: ctx.metadata ?? null,
  });
  return after;
}

/* ============== Canvas 成功次数 ============== */

export async function commitSuccessCount(
  client: Tx,
  budget: SeriesResourceBudgetRow,
  ctx: BudgetEventCtx,
): Promise<SeriesResourceBudgetRow> {
  const after = await client.seriesResourceBudget.update({
    where: { id: budget.id },
    data: { committedUsage: { increment: BigInt(1) } },
  });
  if (
    after.totalBudget > BigInt(0) &&
    after.committedUsage > after.totalBudget &&
    after.status === "ACTIVE"
  ) {
    await client.seriesResourceBudget.update({
      where: { id: budget.id },
      data: { status: "OVERRUN" },
    });
  }
  await writeBudgetEvent(client, {
    seriesId: budget.seriesId,
    seriesBudgetId: budget.id,
    projectId: ctx.projectId ?? null,
    type: "USAGE_COMMIT",
    metricType: budget.metricType,
    amount: BigInt(1),
    beforeBudget: budget.committedUsage,
    afterBudget: after.committedUsage,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "SYSTEM",
    reason: ctx.reason ?? null,
    metadata: ctx.metadata ?? null,
  });
  return after;
}

/* ============== Owner buffer 调配 ============== */

/**
 * Owner / Admin buffer 调配：
 *   - amount > 0 表示从 buffer 拨给 Project（allocate）。
 *   - amount < 0 表示从 Project 回收 buffer（release）。
 * 不修改 totalBudget。
 */
export async function allocateBuffer(
  client: Tx,
  budgetId: string,
  amount: bigint,
  projectId: string,
  ctx: BudgetEventCtx,
): Promise<{ budget: SeriesResourceBudgetRow; allocation: { allocatedBudget: bigint } }> {
  const budget = await findBudgetById(client, budgetId);
  if (!budget) throw new Error(`SeriesResourceBudget ${budgetId} not found`);
  if (budget.status !== "ACTIVE") throw new Error(`Budget ${budgetId} is ${budget.status}`);

  // 双向都不能突破总池
  if (amount > BigInt(0)) {
    if (budget.unallocatedBudget < amount) {
      throw new Error(
        `buffer 不足：unallocated=${budget.unallocatedBudget} 需要=${amount}`,
      );
    }
  }

  // upsert allocation
  let allocation = await client.projectResourceAllocation.findUnique({
    where: { seriesBudgetId_projectId: { seriesBudgetId: budgetId, projectId } },
  });
  if (!allocation) {
    if (amount < BigInt(0)) throw new Error("没有可回收的分配");
    allocation = await client.projectResourceAllocation.create({
      data: {
        seriesBudgetId: budgetId,
        seriesId: budget.seriesId,
        projectId,
        allocatedBudget: BigInt(0),
      },
    });
  }

  // 回收时不能低于已用 + 已预扣
  const newAllocated = allocation.allocatedBudget + amount;
  const minRequired = allocation.committedUsage + allocation.reservedUsage;
  if (newAllocated < minRequired) {
    throw new Error(
      `调整后分配 ${newAllocated} 不能低于已用+预扣 ${minRequired}`,
    );
  }
  if (newAllocated < BigInt(0)) throw new Error("分配数不能为负");

  const updatedAllocation = await client.projectResourceAllocation.update({
    where: { id: allocation.id },
    data: { allocatedBudget: newAllocated },
  });

  const newUnallocated = budget.unallocatedBudget - amount;
  const updatedBudget = await client.seriesResourceBudget.update({
    where: { id: budgetId },
    data: { unallocatedBudget: newUnallocated },
  });

  await writeBudgetEvent(client, {
    seriesId: budget.seriesId,
    seriesBudgetId: budgetId,
    projectId,
    type: amount >= BigInt(0) ? "BUFFER_ALLOCATE" : "BUFFER_RELEASE",
    metricType: budget.metricType,
    amount: amount >= BigInt(0) ? amount : -amount,
    beforeBudget: allocation.allocatedBudget,
    afterBudget: newAllocated,
    beforeUnallocated: budget.unallocatedBudget,
    afterUnallocated: newUnallocated,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "OWNER",
    reason: ctx.reason ?? null,
    metadata: ctx.metadata ?? null,
  });

  return { budget: updatedBudget, allocation: { allocatedBudget: updatedAllocation.allocatedBudget } };
}

/* ============== Admin 调整 totalBudget ============== */

export async function adjustTotalBudget(
  client: Tx,
  budgetId: string,
  delta: bigint, // 正为增加，负为减少
  ctx: BudgetEventCtx & { operatorRole?: "ADMIN" },
): Promise<SeriesResourceBudgetRow> {
  const before = await findBudgetById(client, budgetId);
  if (!before) throw new Error(`Budget ${budgetId} not found`);
  const minRequired = before.committedUsage + before.reservedUsage;
  const newTotal = before.totalBudget + delta;
  if (newTotal < minRequired) {
    throw new Error(`总预算 ${newTotal} 不能低于已用+预扣 ${minRequired}`);
  }
  if (newTotal < BigInt(0)) throw new Error("总预算不能为负");
  const newUnallocated = before.unallocatedBudget + delta;
  const updated = await client.seriesResourceBudget.update({
    where: { id: budgetId },
    data: {
      totalBudget: newTotal,
      unallocatedBudget: newUnallocated < BigInt(0) ? BigInt(0) : newUnallocated,
    },
  });
  await writeBudgetEvent(client, {
    seriesId: before.seriesId,
    seriesBudgetId: budgetId,
    type: delta >= BigInt(0) ? "ADMIN_ADJUST_INCREASE" : "ADMIN_ADJUST_DECREASE",
    metricType: before.metricType,
    amount: delta >= BigInt(0) ? delta : -delta,
    beforeBudget: before.totalBudget,
    afterBudget: updated.totalBudget,
    beforeUnallocated: before.unallocatedBudget,
    afterUnallocated: updated.unallocatedBudget,
    operatorId: ctx.operatorId ?? null,
    operatorRole: ctx.operatorRole ?? "ADMIN",
    reason: ctx.reason ?? null,
    metadata: ctx.metadata ?? null,
  });
  return updated;
}

/* ============== 顶层 prisma helper（便利方法） ============== */

export const seriesBudgetDb = prisma;
