import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { allocateBuffer } from "@/lib/series-budget";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

const bodySchema = z.object({
  projectId: z.string().min(1),
  delta: z.union([z.number(), z.string()]).transform((v) => BigInt(String(v))),
  reason: z.string().optional(),
});

/**
 * POST /api/workspace/series/[seriesId]/resource-budgets/[budgetId]/allocate-buffer
 * Owner 把 buffer 拨给某个 Episode (delta > 0) 或回收 (delta < 0)。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ seriesId: string; budgetId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId, budgetId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m || m.role !== "OWNER") {
    return NextResponse.json({ error: "需要 OWNER 角色" }, { status: 403 });
  }
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  // 校验目标 project 属于该 series
  const project = await prisma.project.findUnique({
    where: { id: parsed.projectId },
    select: { id: true, seriesId: true },
  });
  if (!project || project.seriesId !== seriesId) {
    return NextResponse.json({ error: "目标集数不属于该项目" }, { status: 400 });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      return allocateBuffer(tx, budgetId, parsed.delta, parsed.projectId, {
        operatorId: session.user!.id,
        operatorRole: "OWNER",
        reason: parsed.reason,
        projectId: parsed.projectId,
      });
    });
    await logUserAction({
      userId: session.user.id,
      category: "series",
      action: parsed.delta >= BigInt(0) ? "series.buffer.allocate" : "series.buffer.release",
      targetType: "SeriesResourceBudget",
      targetId: budgetId,
      projectId: parsed.projectId,
      metadata: { delta: parsed.delta.toString(), reason: parsed.reason },
      route: "/api/workspace/series/[seriesId]/resource-budgets/[budgetId]/allocate-buffer",
    });
    return NextResponse.json({
      budget: {
        ...result.budget,
        totalBudget: result.budget.totalBudget.toString(),
        committedUsage: result.budget.committedUsage.toString(),
        reservedUsage: result.budget.reservedUsage.toString(),
        unallocatedBudget: result.budget.unallocatedBudget.toString(),
      },
      allocation: { allocatedBudget: result.allocation.allocatedBudget.toString() },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "调配失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
