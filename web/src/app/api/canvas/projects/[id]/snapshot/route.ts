import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";

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
  /** v1.9.1: 客户端基于哪个版本修改；未传 = 老客户端（兼容旧 tab 但允许冲突检测 fallback 到 createdAt 时间窗口） */
  baseVersion: z.number().int().min(0).optional(),
  /** v1.9.1: 客户端显式跳过缩量拦截（用户在 UI 上确认"我要清理画布"才传） */
  confirmShrink: z.literal(true).optional(),
  /** v1.9.1: 客户端实例 id（localStorage 持久化），用于审计 */
  clientId: z.string().max(120).optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

/** v1.9.1: 缩量阈值——本次 nodes 少于 DB 现有 nodes × 该比例时认定为可疑覆盖 */
const SHRINK_THRESHOLD_RATIO = 0.5;
/** v1.9.1: 历史记录保留数量上限（按时间 desc 截断） */
const SNAPSHOT_HISTORY_RETENTION = 30;

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
  const cp = await prisma.canvasProject.findFirst({
    where: { id, status: { not: "DELETED" } },
    select: { id: true, userId: true, seriesId: true },
  });
  if (!cp) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  // Access check: legacy owner OR series OWNER/PRODUCER (not VIEWER)
  if (cp.userId !== auth.user.id) {
    if (!cp.seriesId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const m = await getMembership(auth.user.id, cp.seriesId);
    if (!m || m.role === "VIEWER") {
      return NextResponse.json({ error: "VIEWER 不可保存画布" }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    nodes,
    edges,
    viewport,
    thumbnail,
    confirmEmptySnapshot,
    baseVersion,
    confirmShrink,
    clientId,
  } = parsed.data;
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
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const txResult = await prisma.$transaction(async (tx) => {
    // v1.9.1：锁行同时读取 version
    const lockedProject = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT id, version FROM "CanvasProject"
      WHERE id = ${id}
        AND status <> 'DELETED'
      FOR UPDATE
    `;
    if (lockedProject.length === 0) {
      return { status: "missing" as const };
    }
    const currentVersion = lockedProject[0].version;

    const [existingNodeCount, existingEdgeCount, existingNodes, existingEdges, existingProjectRow] =
      await Promise.all([
        tx.canvasNode.count({ where: { projectId: id } }),
        tx.canvasEdge.count({ where: { projectId: id } }),
        tx.canvasNode.findMany({ where: { projectId: id } }),
        tx.canvasEdge.findMany({ where: { projectId: id } }),
        tx.canvasProject.findUnique({ where: { id }, select: { viewport: true } }),
      ]);

    // 1) Stale base version detection（旧 tab / 旧客户端）
    if (typeof baseVersion === "number" && baseVersion !== currentVersion) {
      return {
        status: "stale_version" as const,
        currentVersion,
        baseVersion,
        existingNodeCount,
        existingEdgeCount,
      };
    }

    // 2) Empty snapshot 保留旧逻辑
    if (
      isEmptySnapshot &&
      !confirmEmptySnapshot &&
      (existingNodeCount > 0 || existingEdgeCount > 0)
    ) {
      return {
        status: "blocked_empty" as const,
        existingNodeCount,
        existingEdgeCount,
        currentVersion,
      };
    }

    // 3) v1.9.1：异常缩量拦截——新 node 数明显少于 DB 现有数（疑似旧快照覆盖）
    if (
      !confirmShrink &&
      !isEmptySnapshot &&
      existingNodeCount > 0 &&
      nodes.length < existingNodeCount * SHRINK_THRESHOLD_RATIO
    ) {
      return {
        status: "blocked_shrink" as const,
        currentVersion,
        existingNodeCount,
        existingEdgeCount,
        incomingNodeCount: nodes.length,
        incomingEdgeCount: edges.length,
      };
    }

    // 4) v1.9.1：把"即将被覆盖"的旧状态写入历史（用于事后恢复）
    if (existingNodeCount > 0 || existingEdgeCount > 0) {
      await tx.canvasSnapshotHistory.create({
        data: {
          projectId: id,
          version: currentVersion,
          nodesJson: existingNodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
          })) as unknown as Prisma.InputJsonValue,
          edgesJson: existingEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            type: e.type,
            data: e.data,
          })) as unknown as Prisma.InputJsonValue,
          viewportJson:
            (existingProjectRow?.viewport ?? {}) as Prisma.InputJsonValue,
          nodeCount: existingNodeCount,
          edgeCount: existingEdgeCount,
          userId: auth.user.id,
          userAgent,
          ipAddress,
          clientId: clientId ?? null,
        },
      });

      // 截断历史
      const overflow = await tx.canvasSnapshotHistory.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
        skip: SNAPSHOT_HISTORY_RETENTION,
        select: { id: true },
      });
      if (overflow.length > 0) {
        await tx.canvasSnapshotHistory.deleteMany({
          where: { id: { in: overflow.map((r) => r.id) } },
        });
      }
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
    const newVersion = currentVersion + 1;
    await tx.canvasProject.update({
      where: { id },
      data: {
        version: newVersion,
        ...(viewport ? { viewport: viewport as Prisma.InputJsonValue } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      },
    });

    return { status: "saved" as const, newVersion };
  });

  if (txResult.status === "missing") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (txResult.status === "stale_version") {
    await logUserAction({
      userId: auth.user.id,
      category: "canvas_project",
      action: "canvas_project.snapshot.blocked_stale_version",
      targetType: "CanvasProject",
      targetId: id,
      projectId: id,
      route: `/api/canvas/projects/${id}/snapshot`,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        baseVersion: txResult.baseVersion,
        currentVersion: txResult.currentVersion,
        existingNodeCount: txResult.existingNodeCount,
        existingEdgeCount: txResult.existingEdgeCount,
        userAgent,
        ipAddress,
        clientId: clientId ?? null,
      },
    });
    return NextResponse.json(
      {
        error: "stale_base_version",
        code: "STALE_BASE_VERSION",
        message: "你的画布基于的版本已过期，可能在另一会话中被覆盖",
        server: {
          currentVersion: txResult.currentVersion,
          nodeCount: txResult.existingNodeCount,
          edgeCount: txResult.existingEdgeCount,
        },
      },
      { status: 409 }
    );
  }

  if (txResult.status === "blocked_shrink") {
    await logUserAction({
      userId: auth.user.id,
      category: "canvas_project",
      action: "canvas_project.snapshot.blocked_shrink",
      targetType: "CanvasProject",
      targetId: id,
      projectId: id,
      route: `/api/canvas/projects/${id}/snapshot`,
      metadata: {
        incomingNodeCount: txResult.incomingNodeCount,
        incomingEdgeCount: txResult.incomingEdgeCount,
        existingNodeCount: txResult.existingNodeCount,
        existingEdgeCount: txResult.existingEdgeCount,
        currentVersion: txResult.currentVersion,
        userAgent,
        ipAddress,
        clientId: clientId ?? null,
      },
    });
    return NextResponse.json(
      {
        error: "snapshot_shrink_detected",
        code: "SNAPSHOT_SHRINK_DETECTED",
        message: `本次上传 nodes (${txResult.incomingNodeCount}) 少于 DB 现有 (${txResult.existingNodeCount}) 的一半，疑似旧快照覆盖；如确需精简请在客户端显式确认`,
        server: {
          currentVersion: txResult.currentVersion,
          nodeCount: txResult.existingNodeCount,
          edgeCount: txResult.existingEdgeCount,
        },
      },
      { status: 409 }
    );
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
        code: "EMPTY_SNAPSHOT_REQUIRES_CONFIRM",
        message: "当前项目已有内容，空画布保存需要显式确认",
        server: {
          currentVersion: txResult.currentVersion,
          nodeCount: txResult.existingNodeCount,
          edgeCount: txResult.existingEdgeCount,
        },
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
      confirmShrink: !!confirmShrink,
      baseVersion: baseVersion ?? null,
      newVersion: txResult.newVersion,
      userAgent,
      ipAddress,
      clientId: clientId ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    version: txResult.newVersion,
  });
}
