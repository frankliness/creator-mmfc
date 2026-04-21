import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { saveCanvasImage } from "@/lib/canvas/canvas-storage";
import { logUserAction } from "@/lib/user-action-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12MB
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * 用户在画布上传参考图：multipart/form-data
 *   - field: file (required)
 *   - field: projectId (required)
 *   - field: sourceNodeId (optional)
 */
export async function POST(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求需为 multipart/form-data" }, { status: 400 });
  }

  const projectId = form.get("projectId");
  const sourceNodeId = form.get("sourceNodeId");
  const file = form.get("file");

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `文件超过限制 ${MAX_BYTES / 1024 / 1024}MB` }, { status: 413 });
  }
  const mime = file.type || "image/png";
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json({ error: `不支持的文件类型: ${mime}` }, { status: 415 });
  }

  const project = await prisma.canvasProject.findFirst({
    where: { id: projectId, userId: auth.user.id, status: { not: "DELETED" } },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveCanvasImage({
    userId: auth.user.id,
    projectId,
    buffer,
    mimeType: mime,
  });

  const asset = await prisma.canvasAsset.create({
    data: {
      id: saved.id,
      projectId,
      userId: auth.user.id,
      kind: "UPLOADED_IMAGE",
      mimeType: saved.mimeType,
      bytes: saved.bytes,
      localPath: saved.localPath,
      gcsPath: saved.gcsPath,
      publicUrl: saved.publicUrl,
      sourceNodeId: typeof sourceNodeId === "string" ? sourceNodeId : null,
    },
    select: { id: true, publicUrl: true, mimeType: true, bytes: true },
  });

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_asset",
    action: "canvas_asset.upload",
    targetType: "CanvasAsset",
    targetId: asset.id,
    projectId,
    route: "/api/canvas/assets",
    metadata: {
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      sourceNodeId: typeof sourceNodeId === "string" ? sourceNodeId : null,
    },
  });

  return NextResponse.json({
    assetId: asset.id,
    url: asset.publicUrl ?? saved.publicUrl,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
  }, { status: 201 });
}
