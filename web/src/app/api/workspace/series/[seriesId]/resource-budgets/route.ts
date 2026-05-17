import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  const budgets = await prisma.seriesResourceBudget.findMany({
    where: { seriesId },
    orderBy: [{ budgetScope: "asc" }, { modelKey: "asc" }],
  });
  const allocations = await prisma.projectResourceAllocation.findMany({
    where: { seriesId },
  });
  const allocMap = new Map<string, typeof allocations>();
  for (const a of allocations) {
    const arr = allocMap.get(a.seriesBudgetId) ?? [];
    arr.push(a);
    allocMap.set(a.seriesBudgetId, arr);
  }
  const isOwner = m.role === "OWNER";
  return NextResponse.json(
    budgets.map((b) => {
      const base = {
        id: b.id,
        provider: b.provider,
        modelKey: b.modelKey,
        budgetScope: b.budgetScope,
        metricType: b.metricType,
        totalBudget: b.totalBudget.toString(),
        committedUsage: b.committedUsage.toString(),
        reservedUsage: b.reservedUsage.toString(),
        unallocatedBudget: b.unallocatedBudget.toString(),
        available: (b.totalBudget - b.committedUsage - b.reservedUsage).toString(),
        status: b.status,
      };
      if (!isOwner) return base;
      const allocs = (allocMap.get(b.id) ?? []).map((a) => ({
        projectId: a.projectId,
        allocatedBudget: a.allocatedBudget.toString(),
        committedUsage: a.committedUsage.toString(),
        reservedUsage: a.reservedUsage.toString(),
      }));
      return { ...base, isHardCap: b.isHardCap, allocations: allocs };
    }),
  );
}
