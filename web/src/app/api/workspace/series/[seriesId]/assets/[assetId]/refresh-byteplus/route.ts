import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { refreshByteplusStatus, SeriesAssetError } from "@/lib/series-asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/series/[seriesId]/assets/[assetId]/refresh-byteplus
 * 查询 BytePlus 当前状态并更新到 SeriesAsset。前端轮询时调用。
 * 已是终态（SYNCED/FAILED）时不调用 BytePlus，直接返回当前状态。
 */
export async function POST(
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

  try {
    const result = await refreshByteplusStatus(assetId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SeriesAssetError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "刷新失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
