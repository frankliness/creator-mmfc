import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { logUserAction } from "@/lib/user-action-logger";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ seriesId: string; projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId, projectId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m || m.role !== "OWNER") {
    return NextResponse.json({ error: "需要 OWNER 角色" }, { status: 403 });
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, seriesId: true },
  });
  if (!project || project.seriesId !== seriesId) {
    return NextResponse.json({ error: "集数不存在" }, { status: 404 });
  }
  await prisma.project.update({
    where: { id: projectId },
    data: { lockedReason: null },
  });
  await logUserAction({
    userId: session.user.id,
    category: "series",
    action: "series.episode.unlock",
    targetType: "Project",
    targetId: projectId,
    projectId,
    route: "/api/workspace/series/[seriesId]/projects/[projectId]/unlock",
  });
  return NextResponse.json({ message: "已解锁" });
}
