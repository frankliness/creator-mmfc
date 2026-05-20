import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { logUserAction } from "@/lib/user-action-logger";
import { probeAsset, inferAssetType } from "@/lib/asset-metadata-probe";
import { createSeriesAssetFromUpload, SeriesAssetError } from "@/lib/series-asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024; // 100MB（视频可能较大；视频本身有 BytePlus 限制兜底）

/**
 * GET /api/workspace/series/[seriesId]/assets
 * Query: type, source, syncStatus, keyword, page, size
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || undefined;
  const source = url.searchParams.get("source") || undefined;
  const syncStatus = url.searchParams.get("syncStatus") || undefined;
  const keyword = url.searchParams.get("keyword") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? 50)));

  const where: Record<string, unknown> = { seriesId };
  if (type) where.type = type;
  if (source) where.source = source;
  if (syncStatus) where.byteplusSyncStatus = syncStatus;
  if (keyword) where.name = { contains: keyword, mode: "insensitive" };

  const [items, total, group] = await Promise.all([
    prisma.seriesAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    }),
    prisma.seriesAsset.count({ where }),
    prisma.seriesAssetGroup.findUnique({ where: { seriesId } }),
  ]);

  return NextResponse.json({
    items,
    page,
    size,
    total,
    assetGroup: group,
  });
}

/**
 * POST /api/workspace/series/[seriesId]/assets
 *
 * 手动上传图片 / 视频 / 音频。multipart/form-data。
 * Fields:
 *   - file: 二进制（必填）
 *   - name: 资产名（必填，最大 64 字符）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  if (m.role === "VIEWER") {
    return NextResponse.json({ error: "VIEWER 不可上传素材" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求需为 multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const rawName = form.get("name");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (typeof rawName !== "string" || !rawName.trim()) {
    return NextResponse.json({ error: "缺少资产名称（name 字段）" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `文件超过限制 ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }
  const mime = file.type || "application/octet-stream";
  if (!inferAssetType(mime)) {
    return NextResponse.json({ error: `不支持的文件类型: ${mime}` }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let probe;
  try {
    probe = await probeAsset({ buffer, mimeType: mime });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "metadata probe 失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const { asset, willSync } = await createSeriesAssetFromUpload({
      seriesId,
      userId: session.user.id,
      rawName: rawName.trim(),
      buffer,
      probe,
    });

    await logUserAction({
      userId: session.user.id,
      category: "series_asset",
      action: "series_asset.upload",
      targetType: "SeriesAsset",
      targetId: asset.id,
      route: `/api/workspace/series/${seriesId}/assets`,
      metadata: { name: asset.name, type: asset.type, bytes: asset.bytes, willSync },
    });

    return NextResponse.json({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      ossPublicUrl: asset.ossPublicUrl,
      byteplusSyncStatus: asset.byteplusSyncStatus,
      willSync,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof SeriesAssetError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "上传失败";
    console.error("[series-asset-upload]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
