import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  const projects = await prisma.project.findMany({
    where: { seriesId },
    orderBy: [{ episodeNumber: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { storyboards: true } } },
  });
  return NextResponse.json(projects);
}
