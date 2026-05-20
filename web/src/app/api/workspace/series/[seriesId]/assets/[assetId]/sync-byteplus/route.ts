import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { retrySyncByteplus, SeriesAssetError } from "@/lib/series-asset-service";
import { logUserAction } from "@/lib/user-action-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/series/[seriesId]/assets/[assetId]/sync-byteplus
 * 触发 BytePlus CreateAsset（首次同步或失败重试）。
 * 立即返回 SYNCING，前端轮询 refresh-byteplus 接口刷新状态。
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
  if (m.role === "VIEWER") {
    return NextResponse.json({ error: "VIEWER 不可触发同步" }, { status: 403 });
  }

  const asset = await prisma.seriesAsset.findFirst({
    where: { id: assetId, seriesId },
  });
  if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });

  try {
    const result = await retrySyncByteplus(assetId);
    await logUserAction({
      userId: session.user.id,
      category: "series_asset",
      action: "series_asset.sync_byteplus",
      targetType: "SeriesAsset",
      targetId: assetId,
      route: `/api/workspace/series/${seriesId}/assets/${assetId}/sync-byteplus`,
      metadata: { status: result.status },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SeriesAssetError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "同步失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
