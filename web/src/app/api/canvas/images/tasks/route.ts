/**
 * GET /api/canvas/images/tasks?projectId=xxx&status=active
 *
 * 列出当前用户在某项目下的画布图任务。前端在打开画布时可以一次性拉取所有"在途"任务，
 * 用 sourceNodeId 把节点的轮询恢复起来。
 *
 * Query：
 *   - projectId  必填
 *   - status     可选：'active'（PENDING+RUNNING，默认） / 'all'
 *   - limit      可选：默认 50，最大 200
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }

  const statusFilter = url.searchParams.get("status") ?? "active";
  const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);

  const where: { userId: string; projectId: string; status?: { in: string[] } } = {
    userId: auth.user.id,
    projectId,
  };
  if (statusFilter === "active") {
    where.status = { in: ["PENDING", "RUNNING"] };
  }

  const tasks = await prisma.canvasImageTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      sourceNodeId: true,
      model: true,
      isEdit: true,
      createdAt: true,
      startedAt: true,
    },
  });

  return NextResponse.json({ tasks });
}
