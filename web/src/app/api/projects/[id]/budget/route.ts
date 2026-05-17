import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;

  // Find the project — allow if owned by user OR belongs to a series where user is member
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, userId: true, seriesId: true } });
  if (!project) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const isOwner = project.userId === session.user.id;
  if (!isOwner && !project.seriesId) return NextResponse.json({ error: "无权限" }, { status: 403 });
  if (project.seriesId) {
    const m = await getMembership(session.user.id, project.seriesId);
    if (!m && !isOwner) return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  if (!project.seriesId) return NextResponse.json([]);

  const [budgets, allocations] = await Promise.all([
    prisma.seriesResourceBudget.findMany({
      where: { seriesId: project.seriesId, metricType: "TOKEN" },
      orderBy: [{ budgetScope: "asc" }, { modelKey: "asc" }],
    }),
    prisma.projectResourceAllocation.findMany({ where: { projectId: id } }),
  ]);

  const allocByBudget = new Map(allocations.map((a) => [a.seriesBudgetId, a]));

  return NextResponse.json(
    budgets.map((b) => {
      const alloc = allocByBudget.get(b.id) ?? null;
      return {
        budgetId: b.id,
        provider: b.provider,
        modelKey: b.modelKey,
        budgetScope: b.budgetScope,
        status: b.status,
        series: {
          totalBudget: b.totalBudget.toString(),
          committedUsage: b.committedUsage.toString(),
          reservedUsage: b.reservedUsage.toString(),
          unallocatedBudget: b.unallocatedBudget.toString(),
        },
        episode: alloc
          ? {
              allocatedBudget: alloc.allocatedBudget.toString(),
              committedUsage: alloc.committedUsage.toString(),
              reservedUsage: alloc.reservedUsage.toString(),
            }
          : null,
      };
    }),
  );
}
