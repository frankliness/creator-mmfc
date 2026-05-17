import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { readCanvasAsset } from "@/lib/canvas/canvas-storage";
import { getMembership } from "@/lib/series-membership";

export const runtime = "nodejs";

/**
 * 鉴权后回吐资源字节流。
 * - 资源 owner 本人可读
 * - v1.9.0：资源所属 CanvasProject 归属某 Series 时，该 Series 的 ACTIVE 成员（含 VIEWER）也可读
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const asset = await prisma.canvasAsset.findUnique({
    where: { id },
    select: {
      userId: true,
      mimeType: true,
      bytes: true,
      localPath: true,
      gcsPath: true,
      project: {
        select: { seriesId: true },
      },
    },
  });

  if (!asset) {
    return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  }

  // 鉴权：owner OR series 成员
  let allowed = asset.userId === auth.user.id;
  if (!allowed && asset.project?.seriesId) {
    const m = await getMembership(auth.user.id, asset.project.seriesId);
    if (m) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  }

  const file = await readCanvasAsset({ localPath: asset.localPath, gcsPath: asset.gcsPath });
  if (!file) {
    return NextResponse.json({ error: "文件已丢失" }, { status: 410 });
  }

  const isDownload = req.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(file.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(file.buffer.byteLength),
      "Cache-Control": "private, max-age=0",
      ...(isDownload
        ? { "Content-Disposition": `attachment; filename="canvas-${id}"` }
        : {}),
    },
  });
}
