/**
 * GET /api/canvas/images/tasks/[id]
 *
 * 前端拿 POST /api/canvas/images 返回的 taskId 轮询此接口直到 status 进入 SUCCEEDED 或 FAILED。
 * 终态返回 images / revisedPrompt 与原同步接口字段对齐，前端组件几乎不需要改造。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AssetMini {
  id: string;
  publicUrl: string | null;
  mimeType: string;
  bytes: number;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

  const task = await prisma.canvasImageTask.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      projectId: true,
      sourceNodeId: true,
      status: true,
      model: true,
      credentialId: true,
      isEdit: true,
      size: true,
      quality: true,
      upstreamProvider: true,
      resultAssetIds: true,
      revisedPrompt: true,
      durationMs: true,
      costEstimate: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      attempts: true,
    },
  });

  if (!task || task.userId !== auth.user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  // PENDING 时计算队列位置（全平台 + 本人各一份），用于前端展示"前面 X 个"
  // 仅 PENDING 计算，避免给已 RUNNING/终态任务做无谓查询
  let queuePosition: {
    global: number;
    user: number;
  } | null = null;
  if (task.status === "PENDING") {
    const [globalAhead, userAhead] = await Promise.all([
      prisma.canvasImageTask.count({
        where: {
          status: "PENDING",
          createdAt: { lt: task.createdAt },
        },
      }),
      prisma.canvasImageTask.count({
        where: {
          status: "PENDING",
          userId: task.userId,
          createdAt: { lt: task.createdAt },
        },
      }),
    ]);
    queuePosition = { global: globalAhead + 1, user: userAhead + 1 };
  }

  // 终态：把 assetIds 还原成 { url, mimeType, bytes } 列表，与同步接口字段一致
  let images: Array<{ assetId: string; url: string; mimeType: string; bytes: number }> = [];
  if (task.status === "SUCCEEDED") {
    const ids = Array.isArray(task.resultAssetIds) ? (task.resultAssetIds as string[]) : [];
    if (ids.length > 0) {
      const assets: AssetMini[] = await prisma.canvasAsset.findMany({
        where: { id: { in: ids } },
        select: { id: true, publicUrl: true, mimeType: true, bytes: true },
      });
      const byId = new Map(assets.map((a) => [a.id, a]));
      images = ids
        .map((aid) => {
          const a = byId.get(aid);
          if (!a) return null;
          return {
            assetId: a.id,
            url: a.publicUrl ?? `/api/canvas/assets/${a.id}`,
            mimeType: a.mimeType,
            bytes: a.bytes,
          };
        })
        .filter((x): x is { assetId: string; url: string; mimeType: string; bytes: number } => x !== null);
    }
  }

  return NextResponse.json({
    taskId: task.id,
    status: task.status, // PENDING / RUNNING / SUCCEEDED / FAILED
    projectId: task.projectId,
    sourceNodeId: task.sourceNodeId,
    model: task.model,
    isEdit: task.isEdit,
    size: task.size,
    quality: task.quality,
    upstreamProvider: task.upstreamProvider,
    durationMs: task.durationMs,
    costEstimate: task.costEstimate ? Number(task.costEstimate) : null,
    attempts: task.attempts,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    // 仅 PENDING 时有值；{ global, user } 均为 1-based 排名（含自己）
    queuePosition,
    // 终态字段：仅 SUCCEEDED 时有意义
    images,
    revisedPrompt: task.revisedPrompt,
    // 错误：仅 FAILED 时有意义
    error: task.error,
  });
}
