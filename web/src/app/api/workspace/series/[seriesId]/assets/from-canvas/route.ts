import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { probeAsset } from "@/lib/asset-metadata-probe";
import {
  createSeriesAssetFromCanvas,
  SeriesAssetError,
  maybeTriggerByteplusSync,
} from "@/lib/series-asset-service";
import { validateAssetName } from "@/lib/asset-naming";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  canvasAssetId: z.string().min(1),
  name: z.string().min(1).max(64),
});

/**
 * POST /api/workspace/series/[seriesId]/assets/from-canvas
 *
 * Canvas 生成图片 → Series 素材库的"同步"链路。
 * 用户在 Canvas 节点点击"同步到素材库" → 弹命名 → 调本接口。
 * 与手动上传不同：默认 byteplusSyncStatus=NOT_SYNCED，需要用户在素材库页面再次手动点同步。
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
    return NextResponse.json({ error: "VIEWER 不可同步" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数错误", details: parsed.error.flatten() }, { status: 400 });
  }
  const { canvasAssetId, name } = parsed.data;

  const nameCheck = validateAssetName(name);
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.error }, { status: 400 });
  }

  const canvasAsset = await prisma.canvasAsset.findUnique({
    where: { id: canvasAssetId },
    select: {
      id: true,
      projectId: true,
      userId: true,
      mimeType: true,
      localPath: true,
      gcsPath: true,
      publicUrl: true,
      project: { select: { seriesId: true } },
    },
  });
  if (!canvasAsset) return NextResponse.json({ error: "Canvas 资产不存在" }, { status: 404 });

  // 校验 Canvas 资产属于当前 Series（或 owner 自有 Canvas）
  if (canvasAsset.project?.seriesId && canvasAsset.project.seriesId !== seriesId) {
    return NextResponse.json(
      { error: "该 Canvas 资产不属于当前 Series" },
      { status: 403 },
    );
  }
  // legacy Canvas（无 seriesId）：只允许 owner 同步到自己的 Series 素材库
  if (!canvasAsset.project?.seriesId && canvasAsset.userId !== session.user.id) {
    return NextResponse.json({ error: "无权同步该 Canvas 资产" }, { status: 403 });
  }

  // 读取 Canvas 二进制：优先 localPath（最快），其次内部 publicUrl
  let buffer: Buffer;
  try {
    if (canvasAsset.localPath) {
      buffer = await fs.readFile(canvasAsset.localPath);
    } else if (canvasAsset.publicUrl) {
      const reqUrl = new URL(req.url);
      const fetchUrl = canvasAsset.publicUrl.startsWith("http")
        ? canvasAsset.publicUrl
        : `${reqUrl.origin}${canvasAsset.publicUrl}`;
      const res = await fetch(fetchUrl, {
        headers: req.headers,
      });
      if (!res.ok) throw new Error(`读取 Canvas 资产失败 ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    } else {
      return NextResponse.json({ error: "Canvas 资产无可访问路径" }, { status: 500 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取 Canvas 资产失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let probe;
  try {
    probe = await probeAsset({ buffer, mimeType: canvasAsset.mimeType });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "metadata probe 失败" },
      { status: 400 },
    );
  }

  try {
    const asset = await createSeriesAssetFromCanvas({
      seriesId,
      canvasProjectId: canvasAsset.projectId,
      canvasAssetId: canvasAsset.id,
      rawName: name,
      buffer,
      probe,
      createdBy: session.user.id,
    });

    // Canvas 链路：默认 NOT_SYNCED，但提供 sync=true 参数立即触发同步
    const shouldSync = new URL(req.url).searchParams.get("sync") === "true";
    if (shouldSync) {
      await maybeTriggerByteplusSync(asset.id, seriesId);
    }

    await logUserAction({
      userId: session.user.id,
      category: "series_asset",
      action: "series_asset.from_canvas",
      targetType: "SeriesAsset",
      targetId: asset.id,
      route: `/api/workspace/series/${seriesId}/assets/from-canvas`,
      metadata: { canvasAssetId, name, autoSync: shouldSync },
    });

    return NextResponse.json({
      assetId: asset.id,
      name: asset.name,
      ossPublicUrl: asset.ossPublicUrl,
      byteplusSyncStatus: shouldSync ? "SYNCING" : asset.byteplusSyncStatus,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof SeriesAssetError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "同步失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
