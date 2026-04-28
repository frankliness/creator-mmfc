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
  confirmEmptySnapshot: z.literal(true).optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

const findDuplicateId = (items: Array<{ id: string }>) => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return item.id;
    seen.add(item.id);
  }
  return null;
};

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

  const { nodes, edges, viewport, thumbnail, confirmEmptySnapshot } = parsed.data;
  const duplicateNodeId = findDuplicateId(nodes);
  if (duplicateNodeId) {
    return NextResponse.json(
      { error: "参数错误", message: `重复的节点 ID: ${duplicateNodeId}` },
      { status: 400 }
    );
  }

  const duplicateEdgeId = findDuplicateId(edges);
  if (duplicateEdgeId) {
    return NextResponse.json(
      { error: "参数错误", message: `重复的连线 ID: ${duplicateEdgeId}` },
      { status: 400 }
    );
  }

  const isEmptySnapshot = nodes.length === 0 && edges.length === 0;
  const txResult = await prisma.$transaction(async (tx) => {
    const lockedProject = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "CanvasProject"
      WHERE id = ${id}
        AND "userId" = ${auth.user.id}
        AND status <> 'DELETED'
      FOR UPDATE
    `;
    if (lockedProject.length === 0) {
      return { status: "missing" as const };
    }

    const [existingNodeCount, existingEdgeCount] = await Promise.all([
      tx.canvasNode.count({ where: { projectId: id } }),
      tx.canvasEdge.count({ where: { projectId: id } }),
    ]);

    if (
      isEmptySnapshot &&
      !confirmEmptySnapshot &&
      (existingNodeCount > 0 || existingEdgeCount > 0)
    ) {
      return {
        status: "blocked_empty" as const,
        existingNodeCount,
        existingEdgeCount,
      };
    }

    // node id 在画布生命周期内重复使用（先 delete 再 create 是最安全的全量覆写）
    await tx.canvasEdge.deleteMany({ where: { projectId: id } });
    await tx.canvasNode.deleteMany({ where: { projectId: id } });
    await tx.canvasNode.createMany({
      data: nodes.map((n) => ({
        id: n.id,
        projectId: id,
        type: n.type,
        position: n.position as Prisma.InputJsonValue,
        data: (n.data ?? {}) as Prisma.InputJsonValue,
      })),
    });
    await tx.canvasEdge.createMany({
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
    });
    await tx.canvasProject.update({
      where: { id },
      data: {
        ...(viewport ? { viewport: viewport as Prisma.InputJsonValue } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      },
    });

    return { status: "saved" as const };
  });

  if (txResult.status === "missing") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (txResult.status === "blocked_empty") {
    await logUserAction({
      userId: auth.user.id,
      category: "canvas_project",
      action: "canvas_project.snapshot.blocked_empty",
      targetType: "CanvasProject",
      targetId: id,
      projectId: id,
      route: `/api/canvas/projects/${id}/snapshot`,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        existingNodeCount: txResult.existingNodeCount,
        existingEdgeCount: txResult.existingEdgeCount,
        emptySnapshotBlocked: true,
      },
    });

    return NextResponse.json(
      {
        error: "empty_snapshot_requires_confirm",
        message: "当前项目已有内容，空画布保存需要显式确认",
      },
      { status: 409 }
    );
  }

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
      confirmEmptySnapshot: !!confirmEmptySnapshot,
    },
  });

  return NextResponse.json({ ok: true, nodeCount: nodes.length, edgeCount: edges.length });
}
