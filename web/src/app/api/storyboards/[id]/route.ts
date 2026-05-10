import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidManualStoryboardDuration } from "@/lib/storyboard-duration";
import { MAX_STORYBOARD_SEED } from "@/lib/storyboard-seed";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

const updateSchema = z.object({
  prompt: z.string().optional(),
  duration: z
    .number()
    .refine(isValidManualStoryboardDuration, "时长仅支持整数秒：4-15 或 -1")
    .optional(),
  assetBindings: z.any().optional(),
  seedanceContentItems: z.any().optional(),
  seed: z
    .number()
    .int()
    .min(1)
    .max(MAX_STORYBOARD_SEED)
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
    include: { project: { select: { userId: true } } },
  });

  if (!storyboard || storyboard.project.userId !== session.user.id) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
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
  if (parsed.data.seed !== undefined) data.seed = parsed.data.seed;

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
      project: { select: { userId: true } },
      _count: { select: { tasks: true } },
    },
  });

  if (!storyboard || storyboard.project.userId !== session.user.id) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
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
