import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  /** v1.9.0：可选绑定到一个 Series（必须是该 Series 的 OWNER / PRODUCER） */
  seriesId: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  // v1.9.0：返回 (我自建的 legacy / seriesId=null) ∪ (我加入的 Series 下的全部 Canvas)
  const memberships = await prisma.projectMember.findMany({
    where: { userId: auth.user.id, status: "ACTIVE" },
    select: { seriesId: true },
  });
  const seriesIds = memberships.map((m) => m.seriesId);

  const list = await prisma.canvasProject.findMany({
    where: {
      status: { not: "DELETED" },
      OR: [
        { userId: auth.user.id },
        ...(seriesIds.length ? [{ seriesId: { in: seriesIds } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      thumbnail: true,
      viewport: true,
      status: true,
      seriesId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // v1.9.0：如果指定了 seriesId，校验是 OWNER / PRODUCER
  if (parsed.data.seriesId) {
    const m = await getMembership(auth.user.id, parsed.data.seriesId);
    if (!m) return NextResponse.json({ error: "你不是该 Series 的成员", code: "NOT_A_MEMBER" }, { status: 403 });
    if (m.role === "VIEWER") return NextResponse.json({ error: "VIEWER 不可创建", code: "READ_ONLY" }, { status: 403 });
  }

  const created = await prisma.canvasProject.create({
    data: {
      userId: auth.user.id,
      name: parsed.data.name,
      seriesId: parsed.data.seriesId ?? null,
    },
    select: {
      id: true,
      name: true,
      viewport: true,
      status: true,
      seriesId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_project",
    action: "canvas_project.create",
    targetType: "CanvasProject",
    targetId: created.id,
    projectId: created.id,
    route: "/api/canvas/projects",
    metadata: {
      name: created.name,
      seriesId: created.seriesId,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
