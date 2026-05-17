import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "1");
  const size = Math.min(100, Number(searchParams.get("size") ?? "20"));
  const skip = (page - 1) * size;
  const [rows, total] = await Promise.all([
    prisma.budgetEvent.findMany({
      where: { seriesId },
      orderBy: { createdAt: "desc" },
      skip,
      take: size,
    }),
    prisma.budgetEvent.count({ where: { seriesId } }),
  ]);
  return NextResponse.json({
    data: rows.map((e) => ({
      ...e,
      amount: e.amount.toString(),
      beforeBudget: e.beforeBudget?.toString() ?? null,
      afterBudget: e.afterBudget?.toString() ?? null,
      beforeUnallocated: e.beforeUnallocated?.toString() ?? null,
      afterUnallocated: e.afterUnallocated?.toString() ?? null,
    })),
    pagination: { page, size, total, totalPages: Math.ceil(total / size) },
  });
}
