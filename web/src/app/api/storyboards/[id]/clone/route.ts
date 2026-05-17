import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const source = await prisma.storyboard.findUnique({
    where: { id },
    include: { project: { select: { userId: true, id: true, seriesId: true, lockedReason: true } } },
  });

  if (!source) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }
  if (source.project.lockedReason) {
    return NextResponse.json({ error: "集数已锁定" }, { status: 423 });
  }
  let allowed = source.project.userId === session.user.id;
  if (!allowed && source.project.seriesId) {
    const m = await getMembership(session.user.id, source.project.seriesId);
    if (m && (m.role === "OWNER" || m.role === "PRODUCER")) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json({ error: "无权操作该分镜" }, { status: 403 });
  }

  // Determine next version suffix: s001 -> s001_1 -> s001_2
  const baseId = source.storyboardId.replace(/_\d+$/, "");
  const siblings = await prisma.storyboard.findMany({
    where: {
      projectId: source.projectId,
      storyboardId: { startsWith: baseId },
    },
    select: { storyboardId: true },
  });

  let maxVersion = 0;
  for (const s of siblings) {
    const match = s.storyboardId.match(/_(\d+)$/);
    if (match) {
      maxVersion = Math.max(maxVersion, parseInt(match[1]));
    }
  }
  const newStoryboardId = `${baseId}_${maxVersion + 1}`;

  // Get max sortOrder for positioning
  const maxSort = await prisma.storyboard.aggregate({
    where: { projectId: source.projectId },
    _max: { sortOrder: true },
  });

  const cloned = await prisma.storyboard.create({
    data: {
      projectId: source.projectId,
      storyboardId: newStoryboardId,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      duration: source.duration,
      seed: source.seed,
      prompt: source.prompt,
      assetBindings: source.assetBindings as object,
      seedanceContentItems: source.seedanceContentItems as object,
      status: "DRAFT",
    },
  });

  console.log(
    `[clone] ${source.storyboardId} -> ${newStoryboardId} (project=${source.projectId})`
  );

  await logUserAction({
    userId: session.user.id,
    category: "storyboard",
    action: "storyboard.clone",
    targetType: "Storyboard",
    targetId: cloned.id,
    projectId: source.projectId,
    storyboardId: cloned.id,
    route: `/api/storyboards/${id}/clone`,
    metadata: {
      sourceStoryboardId: source.id,
      sourceStoryboardCode: source.storyboardId,
      newStoryboardCode: cloned.storyboardId,
    },
  });

  return NextResponse.json(cloned, { status: 201 });
}
