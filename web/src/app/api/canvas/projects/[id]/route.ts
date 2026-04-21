import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  thumbnail: z.string().optional(),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

async function loadOwned(id: string, userId: string) {
  return prisma.canvasProject.findFirst({
    where: { id, userId, status: { not: "DELETED" } },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const project = await loadOwned(id, auth.user.id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const [nodes, edges] = await Promise.all([
    prisma.canvasNode.findMany({ where: { projectId: id } }),
    prisma.canvasEdge.findMany({ where: { projectId: id } }),
  ]);

  return NextResponse.json({
    id: project.id,
    name: project.name,
    thumbnail: project.thumbnail,
    viewport: project.viewport,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodes,
    edges,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const existing = await loadOwned(id, auth.user.id);
  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效字段" }, { status: 400 });
  }

  const updated = await prisma.canvasProject.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      thumbnail: true,
      viewport: true,
      status: true,
      updatedAt: true,
    },
  });

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_project",
    action: "canvas_project.update",
    targetType: "CanvasProject",
    targetId: id,
    projectId: id,
    route: `/api/canvas/projects/${id}`,
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
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const existing = await loadOwned(id, auth.user.id);
  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 软删：保留 nodes/edges/asset，便于 admin 后续清理或恢复
  await prisma.canvasProject.update({
    where: { id },
    data: { status: "DELETED" },
  });

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_project",
    action: "canvas_project.delete",
    targetType: "CanvasProject",
    targetId: id,
    projectId: id,
    route: `/api/canvas/projects/${id}`,
    metadata: {
      name: existing.name,
    },
  });

  return NextResponse.json({ ok: true });
}
