import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/workspace/series — 当前用户被加入的 Series 列表。 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  const seriesIds = memberships.map((m) => m.seriesId);
  if (seriesIds.length === 0) return NextResponse.json([]);
  const series = await prisma.series.findMany({
    where: { id: { in: seriesIds } },
    orderBy: { updatedAt: "desc" },
  });
  const seriesMap = new Map(series.map((s) => [s.id, s]));
  const episodeCounts = await prisma.project.groupBy({
    by: ["seriesId"],
    where: { seriesId: { in: seriesIds } },
    _count: { id: true },
  });
  const eMap = new Map(episodeCounts.map((e) => [e.seriesId, e._count.id]));
  const data = memberships
    .map((m) => {
      const s = seriesMap.get(m.seriesId);
      if (!s) return null;
      return {
        seriesId: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        myRole: m.role,
        episodeCount: eMap.get(s.id) ?? 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    })
    .filter(Boolean);
  return NextResponse.json(data);
}
