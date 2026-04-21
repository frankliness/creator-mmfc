import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { readCanvasAsset } from "@/lib/canvas/canvas-storage";

export const runtime = "nodejs";

/**
 * 鉴权后回吐资源字节流。
 * 仅资源所属用户本人可读（避免 publicUrl 被外部猜测访问）。
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
    },
  });

  if (!asset || asset.userId !== auth.user.id) {
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
