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
import { classifyError } from "@/lib/llm/error-classify";
import { saveCanvasImage, readCanvasAsset } from "@/lib/canvas/canvas-storage";
import { logCanvasCall } from "@/lib/canvas/canvas-logger";
import {
  findBudget,
  commitSuccessCount,
  BUDGET_SCOPE_CANVAS_IMAGE,
  CANVAS_GLOBAL_PROVIDER,
  CANVAS_GLOBAL_MODEL_KEY,
  METRIC_SUCCESS_COUNT,
} from "@/lib/series-budget";
import { logUserAction } from "@/lib/user-action-logger";
import { estimateImageCost } from "@/lib/canvas/cost-table";
import { getCanvasImageTaskTimeoutMs } from "@/lib/canvas/concurrency-config";
import type { GeminiImageRefPart } from "@/lib/canvas/gemini-image";

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_RETRIES = 5;

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
 * 调用约定（v1.5.0 起）：
 *   - 渠道池路径：worker 在 pollCanvasImageTasks 抢占处已经把 status=PENDING→RUNNING
 *     并写好 credentialId + attempts++。这里直接跑。
 *   - bypass 路径（用户级凭据 / rotation 关闭）：worker 只挑出 taskId，本函数自行抢占。
 *
 * 重入安全：发现 status 已经不是 PENDING / RUNNING 时返回 raceLost=true 让 worker 跳过。
 */
export async function runImageTask(taskId: string): Promise<{
  ok: boolean;
  /** 如果别的进程已经在跑，或状态不在 (PENDING/RUNNING) ，返回 raceLost=true 让上层跳过 */
  raceLost?: boolean;
  /** 命中限流且任务已退回 PENDING 等待轮换 */
  rateLimited?: boolean;
}> {
  // Step 1: 抢占。worker 在渠道池路径已经写了 RUNNING+credentialId+attempts++，本函数只对 PENDING 的尝试自己抢。
  const preTask = await prisma.canvasImageTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (!preTask) return { ok: false, raceLost: true };

  if (preTask.status === "PENDING") {
    const claimed = await prisma.canvasImageTask.updateMany({
      where: { id: taskId, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      return { ok: false, raceLost: true };
    }
  } else if (preTask.status !== "RUNNING") {
    // SUCCEEDED / FAILED / 未知值：已是终态或异常状态，直接跳过
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

    const canvasProject = await prisma.canvasProject.findUnique({
      where: { id: task.projectId },
      select: { seriesId: true },
    });

    // v1.9.0：Series Canvas 预算 committedUsage += 1（仅成功路径）
    try {
      if (canvasProject?.seriesId) {
        const budget = await findBudget(prisma, {
          seriesId: canvasProject.seriesId,
          provider: CANVAS_GLOBAL_PROVIDER,
          modelKey: CANVAS_GLOBAL_MODEL_KEY,
          budgetScope: BUDGET_SCOPE_CANVAS_IMAGE,
          metricType: METRIC_SUCCESS_COUNT,
        });
        if (budget && budget.status === "ACTIVE") {
          const idemKey = `canvas:${task.id}`;
          // 幂等：若已写过 FINALIZED 记录则跳过
          const exists = await prisma.tokenUsageLog.findUnique({ where: { idempotencyKey: idemKey } });
          if (!exists) {
            await prisma.$transaction(async (tx) => {
              await commitSuccessCount(tx, budget, {
                operatorId: task.userId,
                operatorRole: "SYSTEM",
                projectId: null,
                reason: "Worker Canvas success",
                metadata: { canvasImageTaskId: task.id, actualCallType: task.callType },
              });
              await tx.tokenUsageLog.create({
                data: {
                  userId: task.userId,
                  provider: imageConfig.provider,
                  model: task.model,
                  requestType: task.callType,
                  seriesId: canvasProject.seriesId!,
                  seriesBudgetId: budget.id,
                  canvasProjectId: task.projectId,
                  canvasImageTaskId: task.id,
                  metricType: METRIC_SUCCESS_COUNT,
                  budgetScope: BUDGET_SCOPE_CANVAS_IMAGE,
                  actualCallType: task.callType,
                  committedAmount: BigInt(1),
                  status: "FINALIZED",
                  finalizedAt: new Date(),
                  idempotencyKey: idemKey,
                  metadata: { saved: saved.length, durationMs, upstreamProvider: imageConfig.provider },
                },
              });
            });
          }
        }
      }
    } catch (budgetErr) {
      console.error("[image-task] Series canvas budget commit failed:", budgetErr);
    }

    // Step 7: 审计日志
    await logCanvasCall({
      userId: task.userId,
      projectId: task.projectId,
      seriesId: canvasProject?.seriesId ?? null,
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
      credentialId: task.credentialId,
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
    const classified = classifyError(err);

    // 限流路径：仅在 (有渠道、未绕过轮询、未触顶硬上限) 时退回 PENDING 让别的渠道接手
    if (
      classified.isRateLimit &&
      task.credentialId &&
      !task.bypassRotation &&
      task.cooldownRetries < MAX_COOLDOWN_RETRIES
    ) {
      const cooldownMs = classified.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
      console.warn(
        `[image-task] ${task.id} rate-limited on credential ${task.credentialId}, cooldown ${cooldownMs}ms, retry #${task.cooldownRetries + 1}`
      );

      // 给渠道打冷却（不论本任务接下来怎样，其它任务也不该再撞到这条 key）
      await prisma.providerCredential.update({
        where: { id: task.credentialId },
        data: { cooldownUntil: new Date(Date.now() + cooldownMs) },
      }).catch((e) => {
        console.error(`[image-task] set cooldown failed for cred ${task.credentialId}:`, e);
      });

      // 把任务退回 PENDING；清掉 credentialId 让下一 tick 由其他渠道接走
      await prisma.canvasImageTask.update({
        where: { id: task.id },
        data: {
          status: "PENDING",
          credentialId: null,
          startedAt: null,
          cooldownRetries: { increment: 1 },
        },
      });

      await logCanvasCall({
        userId: task.userId,
        projectId: task.projectId,
        callType: task.callType as "canvas_image" | "canvas_image_edit",
        model: task.model,
        durationMs,
        status: "rate_limited",
        error: message,
        size: task.size ?? undefined,
        quality: task.quality ?? undefined,
        upstreamProvider: task.upstreamProvider ?? undefined,
        credentialId: task.credentialId,
      });

      return { ok: false, rateLimited: true };
    }

    // 常规失败：归类记 failureKind，写 FAILED 终态
    console.error(`[image-task] ${task.id} failed (${classified.kind}):`, message);

    await prisma.canvasImageTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        durationMs,
        error: message.slice(0, 4000),
        failureKind: classified.kind,
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
      credentialId: task.credentialId,
    });

    return { ok: false };
  }
}
