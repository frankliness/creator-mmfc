import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).passthrough(),
  data: z.unknown(),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  data: z.unknown().nullable().optional(),
});

const snapshotSchema = z.object({
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
  thumbnail: z.string().optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

/**
 * 全量覆写：删除旧 nodes/edges 后重建。
 * 画布前端是基于 Vue Flow 的本地状态，统一覆写比 diff 更简单可靠。
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const project = await prisma.canvasProject.findFirst({
    where: { id, userId: auth.user.id, status: { not: "DELETED" } },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { nodes, edges, viewport, thumbnail } = parsed.data;

  // node id 在画布生命周期内重复使用（先 delete 再 create 是最安全的全量覆写）
  await prisma.$transaction([
    prisma.canvasEdge.deleteMany({ where: { projectId: id } }),
    prisma.canvasNode.deleteMany({ where: { projectId: id } }),
    prisma.canvasNode.createMany({
      data: nodes.map((n) => ({
        id: n.id,
        projectId: id,
        type: n.type,
        position: n.position as Prisma.InputJsonValue,
        data: (n.data ?? {}) as Prisma.InputJsonValue,
      })),
    }),
    prisma.canvasEdge.createMany({
      data: edges.map((e) => ({
        id: e.id,
        projectId: id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        type: e.type ?? null,
        data: e.data == null ? Prisma.JsonNull : (e.data as Prisma.InputJsonValue),
      })),
    }),
    prisma.canvasProject.update({
      where: { id },
      data: {
        ...(viewport ? { viewport: viewport as Prisma.InputJsonValue } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      },
    }),
  ]);

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_project",
    action: "canvas_project.snapshot.save",
    targetType: "CanvasProject",
    targetId: id,
    projectId: id,
    route: `/api/canvas/projects/${id}/snapshot`,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      hasViewport: !!viewport,
      hasThumbnail: thumbnail !== undefined,
    },
  });

  return NextResponse.json({ ok: true, nodeCount: nodes.length, edgeCount: edges.length });
}
