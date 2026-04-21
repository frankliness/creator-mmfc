import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { checkImageQuota } from "@/lib/canvas/canvas-quota";
import { logCanvasCall } from "@/lib/canvas/canvas-logger";
import { logUserAction } from "@/lib/user-action-logger";
import {
  generateGeminiImage,
  type GeminiImageRefPart,
} from "@/lib/canvas/gemini-image";
import { readCanvasAsset, saveCanvasImage } from "@/lib/canvas/canvas-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refImageSchema = z.union([
  z.string(), // data URL 或 https URL
  z.object({
    mimeType: z.string().optional(),
    data: z.string(), // base64
  }),
]);

/** 画布前端可能把 size/quality 传成 number，统一转成 string 再校验 */
const stringish = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : String(v)),
  z.string().optional()
);

const bodySchema = z.object({
  projectId: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  size: stringish, // 1:1 / 16:9 ...
  quality: stringish, // 1K / 2K ...
  sourceNodeId: z.string().optional(),
  refImages: z.array(refImageSchema).optional(),
});

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;
const CANVAS_ASSET_PATH_RE = /^\/api\/canvas\/assets\/([^/?#]+)(?:[?#].*)?$/i;

async function loadOwnedCanvasAssetAsBase64(assetId: string, userId: string) {
  const asset = await prisma.canvasAsset.findUnique({
    where: { id: assetId },
    select: {
      userId: true,
      mimeType: true,
      localPath: true,
      gcsPath: true,
    },
  });

  if (!asset || asset.userId !== userId) {
    throw new Error(`参考图资源不存在或无权访问: ${assetId}`);
  }

  const file = await readCanvasAsset({
    localPath: asset.localPath,
    gcsPath: asset.gcsPath,
  });
  if (!file) {
    throw new Error(`参考图文件缺失: ${assetId}`);
  }

  return {
    mimeType: asset.mimeType || "image/png",
    data: file.buffer.toString("base64"),
  };
}

async function normalizeRefImages(
  inputs: Array<string | { mimeType?: string; data: string }> | undefined,
  userId: string
): Promise<GeminiImageRefPart[]> {
  if (!inputs || inputs.length === 0) return [];
  const out: GeminiImageRefPart[] = [];
  for (const item of inputs) {
    if (typeof item === "object") {
      out.push({ mimeType: item.mimeType || "image/png", data: item.data });
      continue;
    }
    const m = item.match(DATA_URL_RE);
    if (m) {
      out.push({ mimeType: m[1], data: m[2] });
      continue;
    }
    const assetPathMatch = item.match(CANVAS_ASSET_PATH_RE);
    if (assetPathMatch) {
      out.push(await loadOwnedCanvasAssetAsBase64(assetPathMatch[1], userId));
      continue;
    }
    if (/^https?:\/\//i.test(item)) {
      const r = await fetch(item);
      if (!r.ok) throw new Error(`参考图抓取失败 HTTP ${r.status}: ${item}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/png";
      out.push({ mimeType: mime, data: buf.toString("base64") });
      continue;
    }
    // 兜底：当作裸 base64
    out.push({ mimeType: "image/png", data: item });
  }
  return out;
}

function buildNoImageError(result: { revisedPrompt?: string; raw?: unknown }) {
  const revisedPrompt = typeof result.revisedPrompt === "string" ? result.revisedPrompt.trim() : "";
  if (revisedPrompt) {
    return `Gemini 未返回图片，仅返回文本：${revisedPrompt.slice(0, 200)}`;
  }

  const finishReason = (result.raw as { candidates?: Array<{ finishReason?: string }> } | undefined)
    ?.candidates?.[0]?.finishReason;
  if (finishReason) {
    return `Gemini 未返回图片，finishReason=${finishReason}`;
  }

  return "Gemini 未返回图片";
}

export async function POST(req: NextRequest) {
  const rid = randomUUID().slice(0, 8);
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  let body: unknown = {};
  try {
    body = await req.json();
  } catch (e) {
    console.error(`[canvas/images][${rid}] JSON body parse failed`, e);
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    console.warn(`[canvas/images][${rid}] validation failed`, parsed.error.flatten());
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  console.warn(`[canvas/images][${rid}] start`, {
    userId: auth.user.id,
    projectId: parsed.data.projectId,
    model: parsed.data.model,
    hasRef: !!parsed.data.refImages?.length,
  });

  const project = await prisma.canvasProject.findFirst({
    where: { id: parsed.data.projectId, userId: auth.user.id, status: { not: "DELETED" } },
    select: { id: true },
  });
  if (!project) {
    console.warn(`[canvas/images][${rid}] project not found for user`, {
      projectId: parsed.data.projectId,
      userId: auth.user.id,
    });
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const quota = await checkImageQuota(auth.user.id, 1);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 429 });
  }

  const isEdit = !!parsed.data.refImages?.length;
  const callType = isEdit ? "canvas_image_edit" : "canvas_image";
  const startedAt = Date.now();

  let refImages: GeminiImageRefPart[];
  try {
    refImages = await normalizeRefImages(parsed.data.refImages, auth.user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "参考图处理失败" },
      { status: 400 }
    );
  }

  try {
    const result = await generateGeminiImage({
      model: parsed.data.model,
      prompt: parsed.data.prompt,
      aspectRatio: parsed.data.size,
      imageSize: parsed.data.quality,
      refImages,
    });

    if (result.images.length === 0) {
      throw new Error(buildNoImageError(result));
    }

    // 保存所有图片（一般只有 1 张）
    const saved: Array<{ assetId: string; url: string; mimeType: string; bytes: number }> = [];
    for (const img of result.images) {
      const buffer = Buffer.from(img.base64, "base64");
      const file = await saveCanvasImage({
        userId: auth.user.id,
        projectId: parsed.data.projectId,
        buffer,
        mimeType: img.mimeType,
        requireGcs: true,
      });

      const asset = await prisma.canvasAsset.create({
        data: {
          id: file.id,
          projectId: parsed.data.projectId,
          userId: auth.user.id,
          kind: "GENERATED_IMAGE",
          mimeType: file.mimeType,
          bytes: file.bytes,
          localPath: file.localPath,
          gcsPath: file.gcsPath,
          publicUrl: file.publicUrl,
          sourceNodeId: parsed.data.sourceNodeId ?? null,
        },
        select: { id: true, publicUrl: true, mimeType: true, bytes: true },
      });

      saved.push({
        assetId: asset.id,
        url: asset.publicUrl ?? file.publicUrl,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
      });
    }

    await logCanvasCall({
      userId: auth.user.id,
      projectId: parsed.data.projectId,
      callType,
      model: parsed.data.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      imageCount: saved.length,
      durationMs: Date.now() - startedAt,
      status: "success",
    });

    await logUserAction({
      userId: auth.user.id,
      category: "canvas_asset",
      action: isEdit ? "canvas_asset.generate_edit" : "canvas_asset.generate",
      targetType: "CanvasProject",
      targetId: parsed.data.projectId,
      projectId: parsed.data.projectId,
      route: "/api/canvas/images",
      metadata: {
        model: parsed.data.model,
        assetIds: saved.map((item) => item.assetId),
        imageCount: saved.length,
        sourceNodeId: parsed.data.sourceNodeId ?? null,
      },
    });

    console.warn(`[canvas/images][${rid}] success`, {
      projectId: parsed.data.projectId,
      assets: saved.map((s) => s.assetId),
      ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      images: saved,
      revisedPrompt: result.revisedPrompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "图片生成失败";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[canvas/images][${rid}] failed`, {
      userId: auth.user.id,
      projectId: parsed.data.projectId,
      model: parsed.data.model,
      message,
      stack,
    });
    await logCanvasCall({
      userId: auth.user.id,
      projectId: parsed.data.projectId,
      callType,
      model: parsed.data.model,
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
