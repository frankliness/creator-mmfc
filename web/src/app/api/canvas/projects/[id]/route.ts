import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  thumbnail: z.string().optional(),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  /** v1.9.0：可改 seriesId（限 OWNER 或 legacy 自建者） */
  seriesId: z.string().nullable().optional(),
});

/**
 * v1.9.0：兼容三种归属
 * - legacy：userId 是当前用户
 * - Series：当前用户是该 Series ACTIVE 成员
 */
async function loadAccessible(id: string, userId: string) {
  const cp = await prisma.canvasProject.findFirst({
    where: { id, status: { not: "DELETED" } },
  });
  if (!cp) return null;
  if (cp.userId === userId) return cp;
  if (cp.seriesId) {
    const m = await prisma.projectMember.findUnique({
      where: { seriesId_userId: { seriesId: cp.seriesId, userId } },
    });
    if (m && m.status === "ACTIVE") return cp;
  }
  return null;
}

async function findDuplicateCanvasName(args: {
  id: string;
  name: string;
  userId: string;
  seriesId: string | null;
}) {
  return prisma.canvasProject.findFirst({
    where: {
      id: { not: args.id },
      name: args.name,
      status: { not: "DELETED" },
      ...(args.seriesId
        ? { seriesId: args.seriesId }
        : { userId: args.userId, seriesId: null }),
    },
    select: { id: true },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const { id } = await params;
  const project = await loadAccessible(id, auth.user.id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // Determine edit permission
  let canEdit = true;
  if (project.seriesId && project.userId !== auth.user.id) {
    const m = await getMembership(auth.user.id, project.seriesId);
    canEdit = !!m && m.role !== "VIEWER";
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
    seriesId: project.seriesId,
    canEdit,
    // v1.9.1: 客户端必须基于此 version 提交快照，否则会被服务端 409 拒绝
    version: project.version,
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
  const existing = await loadAccessible(id, auth.user.id);
  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // Block VIEWER from any writes
  if (existing.seriesId && existing.userId !== auth.user.id) {
    const m = await getMembership(auth.user.id, existing.seriesId);
    if (!m || m.role === "VIEWER") {
      return NextResponse.json({ error: "VIEWER 不可修改画布" }, { status: 403 });
    }
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

  // v1.9.0：seriesId 重绑只允许（旧 Series 的 OWNER + 新 Series 的 OWNER/PRODUCER） 或 legacy 自建者解绑自己
  if ("seriesId" in data) {
    const newSeriesId = data.seriesId as string | null;
    // 旧 series 检查
    if (existing.seriesId) {
      const oldM = await getMembership(auth.user.id, existing.seriesId);
      if (!oldM || oldM.role !== "OWNER") {
        return NextResponse.json({ error: "需要原 Series 的 OWNER 才能改归属" }, { status: 403 });
      }
    } else if (existing.userId !== auth.user.id) {
      return NextResponse.json({ error: "无权修改归属" }, { status: 403 });
    }
    // 新 series 检查
    if (newSeriesId) {
      const newM = await getMembership(auth.user.id, newSeriesId);
      if (!newM || newM.role === "VIEWER") {
        return NextResponse.json({ error: "需要新 Series 的 OWNER/PRODUCER" }, { status: 403 });
      }
    }
  }

  if ("name" in data || "seriesId" in data) {
    const targetName = (data.name as string | undefined) ?? existing.name;
    const targetSeriesId = "seriesId" in data
      ? (data.seriesId as string | null)
      : existing.seriesId;
    const duplicate = await findDuplicateCanvasName({
      id,
      name: targetName,
      userId: existing.userId,
      seriesId: targetSeriesId,
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "画布名称已存在，请换一个名称", code: "CANVAS_NAME_DUPLICATE" },
        { status: 409 },
      );
    }
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
      seriesId: true,
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
  const existing = await loadAccessible(id, auth.user.id);
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
