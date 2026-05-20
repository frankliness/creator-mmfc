import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidManualStoryboardDuration } from "@/lib/storyboard-duration";
import { MAX_STORYBOARD_SEED } from "@/lib/storyboard-seed";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";
import { z } from "zod";

async function canWriteStoryboard(
  userId: string,
  project: { userId: string; seriesId: string | null; lockedReason: string | null },
) {
  if (project.lockedReason) return { ok: false as const, reason: "locked" as const };
  if (project.userId === userId) return { ok: true as const };
  if (project.seriesId) {
    const m = await getMembership(userId, project.seriesId);
    if (m && (m.role === "OWNER" || m.role === "PRODUCER")) {
      return { ok: true as const };
    }
  }
  return { ok: false as const, reason: "forbidden" as const };
}

const updateSchema = z.object({
  prompt: z.string().optional(),
  duration: z
    .number()
    .refine(isValidManualStoryboardDuration, "时长仅支持整数秒：4-15 或 -1")
    .optional(),
  /** Legacy 字段：新链路不再写入，但保留供前端兼容性更新 */
  assetBindings: z.any().optional(),
  seedanceContentItems: z.any().optional(),
  /** v2.0.0：新链路字段 */
  generationMode: z.enum(["FIRST_FRAME", "MULTIMODAL"]).nullable().optional(),
  assetRefs: z.any().optional(),
  seed: z
    .number()
    .int()
    .min(1)
    .max(MAX_STORYBOARD_SEED)
    .nullable()
    .optional(),
  displayName: z
    .string()
    .trim()
    .max(80, "分镜名称最长 80 字符")
    .nullable()
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id },
    include: { project: { select: { userId: true, seriesId: true, lockedReason: true } } },
  });

  if (!storyboard) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }
  const access = await canWriteStoryboard(session.user.id, storyboard.project);
  if (!access.ok) {
    if (access.reason === "locked") {
      return NextResponse.json({ error: "集数已锁定" }, { status: 423 });
    }
    return NextResponse.json({ error: "无权操作该分镜" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.prompt !== undefined) data.prompt = parsed.data.prompt;
  if (parsed.data.duration !== undefined) data.duration = parsed.data.duration;
  if (parsed.data.assetBindings !== undefined)
    data.assetBindings = parsed.data.assetBindings;
  if (parsed.data.seedanceContentItems !== undefined)
    data.seedanceContentItems = parsed.data.seedanceContentItems;
  if (parsed.data.generationMode !== undefined)
    data.generationMode = parsed.data.generationMode;
  if (parsed.data.assetRefs !== undefined)
    data.assetRefs = parsed.data.assetRefs;
  if (parsed.data.seed !== undefined) data.seed = parsed.data.seed;
  if (parsed.data.displayName !== undefined) {
    // 空字符串/null 都表示清除自定义名，回落到 storyboardId
    data.displayName = parsed.data.displayName ? parsed.data.displayName : null;
  }

  const updated = await prisma.storyboard.update({ where: { id }, data });

  await logUserAction({
    userId: session.user.id,
    category: "storyboard",
    action: "storyboard.update",
    targetType: "Storyboard",
    targetId: id,
    projectId: storyboard.projectId,
    storyboardId: id,
    route: `/api/storyboards/${id}`,
    metadata: {
      patch: data,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id },
    include: {
      project: { select: { userId: true, seriesId: true, lockedReason: true } },
      _count: { select: { tasks: true } },
    },
  });

  if (!storyboard) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }
  const access = await canWriteStoryboard(session.user.id, storyboard.project);
  if (!access.ok) {
    if (access.reason === "locked") {
      return NextResponse.json({ error: "集数已锁定" }, { status: 423 });
    }
    return NextResponse.json({ error: "无权操作该分镜" }, { status: 403 });
  }

  if (storyboard.status !== "DRAFT" || storyboard._count.tasks > 0) {
    return NextResponse.json(
      { error: "仅未提交且没有生成任务的草稿分镜可删除" },
      { status: 400 }
    );
  }

  await prisma.storyboard.delete({ where: { id } });

  await logUserAction({
    userId: session.user.id,
    category: "storyboard",
    action: "storyboard.delete",
    targetType: "Storyboard",
    targetId: id,
    projectId: storyboard.projectId,
    storyboardId: id,
    route: `/api/storyboards/${id}`,
    metadata: {
      storyboardCode: storyboard.storyboardId,
    },
  });

  return NextResponse.json({ message: "已删除" });
}
