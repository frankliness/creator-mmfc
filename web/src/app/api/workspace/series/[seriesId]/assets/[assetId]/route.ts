import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/series/[seriesId]/assets/[assetId]
 * 单资产详情。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ seriesId: string; assetId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId, assetId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  const asset = await prisma.seriesAsset.findFirst({
    where: { id: assetId, seriesId },
  });
  if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
  return NextResponse.json(asset);
}
