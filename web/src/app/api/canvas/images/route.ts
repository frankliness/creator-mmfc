/**
 * POST /api/canvas/images — v1.4.0 起改为异步任务模式
 *
 * 旧版同步等 10–40 分钟会被任意 HTTP 超时打断（浏览器/CDN/反向代理任意一环）。
 * 现在路由的职责仅限：
 *   1. 鉴权 + 项目存在性
 *   2. 入参 / 配额 / 模型能力 校验
 *   3. 创建 CanvasImageTask 行（status=PENDING）
 *   4. 立刻返回 { taskId, status }，由 Worker 真正调 provider
 *
 * 实际生图、落盘、写资产、写审计日志在 worker (web/src/worker/index.ts) 里跑。
 * 前端拿 taskId 后轮询 GET /api/canvas/images/tasks/:id 直到终态。
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { checkImageQuota } from "@/lib/canvas/canvas-quota";
import { getCapabilities, supportsImageEdit } from "@/lib/llm/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refImageSchema = z.union([
  z.string(),
  z.object({
    mimeType: z.string().optional(),
    data: z.string(),
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
  /** v1.3.0：可选指定凭据 id */
  credentialId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(8000),
  size: stringish,
  quality: stringish,
  sourceNodeId: z.string().optional(),
  refImages: z.array(refImageSchema).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const project = await prisma.canvasProject.findFirst({
    where: { id: parsed.data.projectId, userId: auth.user.id, status: { not: "DELETED" } },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 配额检查需要把 in-flight（PENDING/RUNNING）任务计入：避免用户狂提交
  const inFlightCount = await prisma.canvasImageTask.count({
    where: {
      userId: auth.user.id,
      status: { in: ["PENDING", "RUNNING"] },
      createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
  });
  const quota = await checkImageQuota(auth.user.id, 1 + inFlightCount);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 429 });
  }

  const isEdit = !!parsed.data.refImages?.length;
  const callType = isEdit ? "canvas_image_edit" : "canvas_image";

  // 能力预检：图生图需要的模型不支持时立即返回
  if (isEdit && getCapabilities(parsed.data.model) && !supportsImageEdit(parsed.data.model)) {
    return NextResponse.json(
      {
        error: `模型 ${parsed.data.model} 不支持图生图（image edit），请改用 gpt-image-1 或 Gemini Nano Banana 系列`,
      },
      { status: 400 }
    );
  }

  // refImagesSnapshot 直接保存原始输入数组（asset paths / data URLs / 内嵌对象）。
  // 由 worker 在 runImageTask 中通过 normalizeRefImagesFromSnapshot 还原成 base64。
  const task = await prisma.canvasImageTask.create({
    data: {
      userId: auth.user.id,
      projectId: parsed.data.projectId,
      sourceNodeId: parsed.data.sourceNodeId ?? null,
      status: "PENDING",
      callType,
      model: parsed.data.model,
      credentialId: parsed.data.credentialId ?? null,
      prompt: parsed.data.prompt,
      size: parsed.data.size ?? null,
      quality: parsed.data.quality ?? null,
      isEdit,
      refImagesSnapshot:
        parsed.data.refImages && parsed.data.refImages.length > 0
          ? (parsed.data.refImages as unknown as object)
          : undefined,
    },
    select: { id: true, status: true, createdAt: true },
  });

  return NextResponse.json(
    {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
    },
    { status: 202 }
  );
}
