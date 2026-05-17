import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

const bodySchema = z.object({
  reason: z.string().min(1, "lock 时必须提供 reason"),
});

export async function POST(
  req: NextRequest,
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
    select: { id: true, seriesId: true, lockedReason: true },
  });
  if (!project || project.seriesId !== seriesId) {
    return NextResponse.json({ error: "集数不存在" }, { status: 404 });
  }
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  await prisma.project.update({
    where: { id: projectId },
    data: { lockedReason: parsed.reason },
  });
  await logUserAction({
    userId: session.user.id,
    category: "series",
    action: "series.episode.lock",
    targetType: "Project",
    targetId: projectId,
    projectId,
    metadata: { reason: parsed.reason },
    route: "/api/workspace/series/[seriesId]/projects/[projectId]/lock",
  });
  return NextResponse.json({ message: "已锁定", lockedReason: parsed.reason });
}
