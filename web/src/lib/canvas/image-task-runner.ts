/**
 * Canvas image task runner — v1.4.0
 *
 * 把"调 provider → 落盘 → 写 CanvasAsset → 写 CanvasAiCall → 写 UserActionLog"
 * 这条流水抽出来，让 worker（异步任务）和 API（极端兜底）都能调用。
 *
 * 调用方负责：
 *   - 鉴权 / 项目存在性 / quota 检查
 *   - 创建 CanvasImageTask 行（status=PENDING）
 *
 * 本模块负责：
 *   - 把 task 由 PENDING 推到 RUNNING / SUCCEEDED / FAILED
 *   - 解析 ProviderCredential，调 provider，保存图片
 *   - 写两份审计日志
 *
 * 失败语义：抛出的异常被捕获后写入 task.error；调用方拿到 task 即知结果。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateProviderImage } from "@/lib/llm/image";
import { resolveImageByModel, resolveImageEditByModel } from "@/lib/llm/credential-resolver";
import { saveCanvasImage, readCanvasAsset } from "@/lib/canvas/canvas-storage";
import { logCanvasCall } from "@/lib/canvas/canvas-logger";
import { logUserAction } from "@/lib/user-action-logger";
import { estimateImageCost } from "@/lib/canvas/cost-table";
import { getCanvasImageTaskTimeoutMs } from "@/lib/canvas/concurrency-config";
import type { GeminiImageRefPart } from "@/lib/canvas/gemini-image";

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;
const CANVAS_ASSET_PATH_RE = /^\/api\/canvas\/assets\/([^/?#]+)(?:[?#].*)?$/i;

async function loadOwnedCanvasAssetAsBase64(
  assetId: string,
  userId: string
): Promise<GeminiImageRefPart> {
  const asset = await prisma.canvasAsset.findUnique({
    where: { id: assetId },
    select: { userId: true, mimeType: true, localPath: true, gcsPath: true },
  });
  if (!asset || asset.userId !== userId) {
    throw new Error(`参考图资源不存在或无权访问: ${assetId}`);
  }
  const file = await readCanvasAsset({ localPath: asset.localPath, gcsPath: asset.gcsPath });
  if (!file) throw new Error(`参考图文件缺失: ${assetId}`);
  return {
    mimeType: asset.mimeType || "image/png",
    data: file.buffer.toString("base64"),
  };
}

/**
 * 把任务里保存的 refImagesSnapshot（asset path / data URL / http URL / 内嵌 base64 对象）
 * 还原成调 provider 时需要的 base64 数组。
 */
export async function normalizeRefImagesFromSnapshot(
  inputs: unknown,
  userId: string
): Promise<GeminiImageRefPart[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const out: GeminiImageRefPart[] = [];
  for (const item of inputs) {
    if (typeof item === "object" && item !== null && "data" in item && typeof item.data === "string") {
      const obj = item as { mimeType?: string; data: string };
      out.push({ mimeType: obj.mimeType || "image/png", data: obj.data });
      continue;
    }
    if (typeof item !== "string") continue;
    const m = item.match(DATA_URL_RE);
    if (m) {
      out.push({ mimeType: m[1]!, data: m[2]! });
      continue;
    }
    const assetPathMatch = item.match(CANVAS_ASSET_PATH_RE);
    if (assetPathMatch) {
      out.push(await loadOwnedCanvasAssetAsBase64(assetPathMatch[1]!, userId));
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
    out.push({ mimeType: "image/png", data: item });
  }
  return out;
}

function buildNoImageError(result: { revisedPrompt?: string; raw?: unknown }): string {
  const revisedPrompt = typeof result.revisedPrompt === "string" ? result.revisedPrompt.trim() : "";
  if (revisedPrompt) {
    return `模型未返回图片，仅返回文本：${revisedPrompt.slice(0, 200)}`;
  }
  const finishReason = (result.raw as { candidates?: Array<{ finishReason?: string }> } | undefined)
    ?.candidates?.[0]?.finishReason;
  if (finishReason) return `模型未返回图片，finishReason=${finishReason}`;
  return "模型未返回图片";
}

/**
 * 跑一个 PENDING/RUNNING 任务到终态。返回 task 终态行；不抛异常。
 *
 * 重入安全：内部用条件 update 把 PENDING → RUNNING。如果别的 worker 已经 RUNNING，
 * 这里第一步就会拿不到，直接返回 null（让调用方跳过）。
 */
export async function runImageTask(taskId: string): Promise<{
  ok: boolean;
  /** 如果别的进程已经在跑，返回 null 让上层跳过 */
  raceLost?: boolean;
}> {
  // Step 1: 用条件 update 抢占任务（PENDING → RUNNING）
  const claimed = await prisma.canvasImageTask.updateMany({
    where: { id: taskId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });

  if (claimed.count === 0) {
    // 已经被别的 worker 抢走，或者状态不是 PENDING
    return { ok: false, raceLost: true };
  }

  const task = await prisma.canvasImageTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false };

  const startedAt = task.startedAt?.getTime() ?? Date.now();

  try {
    // Step 2: 解析 refImages
    const refImages = await normalizeRefImagesFromSnapshot(
      task.refImagesSnapshot,
      task.userId
    );

    // Step 3: 解析 ProviderCredential
    const opts = {
      userId: task.userId,
      preferredCredentialId: task.credentialId ?? undefined,
    };
    const imageConfig = task.isEdit
      ? await resolveImageEditByModel(task.model, opts)
      : await resolveImageByModel(task.model, opts);
    const timeoutMs = await getCanvasImageTaskTimeoutMs();

    // Step 4: 调 provider（带超时）
    const result = await Promise.race([
      generateProviderImage(imageConfig, {
        model: task.model,
        prompt: task.prompt,
        aspectRatio: task.size ?? undefined,
        imageSize: task.quality ?? undefined,
        refImages,
        isEdit: task.isEdit,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`provider 调用超过 ${Math.round(timeoutMs / 1000)}s 上限`)),
          timeoutMs
        )
      ),
    ]);

    if (!result.images || result.images.length === 0) {
      throw new Error(buildNoImageError(result));
    }

    // Step 5: 落盘 + 写 CanvasAsset
    const saved: Array<{ assetId: string; url: string; mimeType: string; bytes: number }> = [];
    for (const img of result.images) {
      const buffer = Buffer.from(img.base64, "base64");
      const file = await saveCanvasImage({
        userId: task.userId,
        projectId: task.projectId,
        buffer,
        mimeType: img.mimeType,
        requireGcs: true,
      });

      const asset = await prisma.canvasAsset.create({
        data: {
          id: file.id,
          projectId: task.projectId,
          userId: task.userId,
          kind: "GENERATED_IMAGE",
          mimeType: file.mimeType,
          bytes: file.bytes,
          localPath: file.localPath,
          gcsPath: file.gcsPath,
          publicUrl: file.publicUrl,
          sourceNodeId: task.sourceNodeId ?? null,
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

    const durationMs = Date.now() - startedAt;
    const costEstimate = await estimateImageCost(
      task.model,
      saved.length,
      task.size ?? undefined,
      task.quality ?? undefined,
      task.callType as "canvas_image" | "canvas_image_edit"
    );

    // Step 6: 标记 SUCCEEDED
    await prisma.canvasImageTask.update({
      where: { id: task.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        durationMs,
        upstreamProvider: imageConfig.provider,
        resultAssetIds: saved.map((s) => s.assetId),
        revisedPrompt: result.revisedPrompt ?? null,
        costEstimate: costEstimate
          ? new Prisma.Decimal(costEstimate.toFixed(6))
          : null,
        error: null,
      },
    });

    // Step 7: 审计日志
    await logCanvasCall({
      userId: task.userId,
      projectId: task.projectId,
      callType: task.callType as "canvas_image" | "canvas_image_edit",
      model: task.model,
      inputTokens: result.usage?.inputTokens ?? BigInt(0),
      outputTokens: result.usage?.outputTokens ?? BigInt(0),
      totalTokens: result.usage?.totalTokens ?? BigInt(0),
      imageCount: saved.length,
      durationMs,
      status: "success",
      size: task.size ?? undefined,
      quality: task.quality ?? undefined,
      upstreamProvider: imageConfig.provider,
    });

    await logUserAction({
      userId: task.userId,
      category: "canvas_asset",
      action: task.isEdit ? "canvas_asset.generate_edit" : "canvas_asset.generate",
      targetType: "CanvasProject",
      targetId: task.projectId,
      projectId: task.projectId,
      route: "/api/canvas/images",
      metadata: {
        taskId: task.id,
        model: task.model,
        assetIds: saved.map((s) => s.assetId),
        imageCount: saved.length,
        sourceNodeId: task.sourceNodeId ?? null,
      },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "图片生成失败";
    const durationMs = Date.now() - startedAt;
    console.error(`[image-task] ${task.id} failed:`, message);

    await prisma.canvasImageTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        durationMs,
        error: message.slice(0, 4000),
      },
    });

    await logCanvasCall({
      userId: task.userId,
      projectId: task.projectId,
      callType: task.callType as "canvas_image" | "canvas_image_edit",
      model: task.model,
      durationMs,
      status: "failed",
      error: message,
      size: task.size ?? undefined,
      quality: task.quality ?? undefined,
      upstreamProvider: task.upstreamProvider ?? undefined,
    });

    return { ok: false };
  }
}
