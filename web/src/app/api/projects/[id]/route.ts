import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  script: z.string().optional(),
  fullScript: z.string().optional(),
  style: z.string().optional(),
  ratio: z.enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]).optional(),
  resolution: z.enum(["480p", "720p"]).optional(),
  assetsJson: z.any().optional(),
  assetDescriptions: z.any().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      storyboards: {
        orderBy: { sortOrder: "asc" },
        include: {
          tasks: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // Determine role / access
  let myRole: string;
  if (project.userId === session.user.id) {
    myRole = "LEGACY_OWNER";
  } else if (project.seriesId) {
    const m = await getMembership(session.user.id, project.seriesId);
    if (!m) return NextResponse.json({ error: "无权限" }, { status: 403 });
    myRole = m.role;
  } else {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return NextResponse.json({ ...project, myRole });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.project.findUnique({
    where: { id },
  });

  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // Check write access
  if (existing.userId !== session.user.id) {
    if (!existing.seriesId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const m = await getMembership(session.user.id, existing.seriesId);
    if (!m) return NextResponse.json({ error: "无权限" }, { status: 403 });
    if (m.role === "VIEWER") return NextResponse.json({ error: "VIEWER 无写权限" }, { status: 403 });
    if (existing.lockedReason) return NextResponse.json({ error: `项目已锁定：${existing.lockedReason}` }, { status: 423 });
  }

  if (["GENERATING_STORYBOARDS", "GENERATING_VIDEOS"].includes(existing.status)) {
    return NextResponse.json(
      { error: "生成中的项目不可编辑，请等待完成后再修改" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as Record<string, unknown>;

  // v1.9.1：Series 项目的 style/ratio/resolution 由 Series 全局设置管控，集数 PATCH 一律拒绝写
  if (existing.seriesId) {
    const blocked = ["style", "ratio", "resolution"].filter((k) => k in patch);
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: `字段 ${blocked.join("、")} 由 Series 全局设置控制，请在 Series 设置中统一修改`,
          code: "FIELD_OWNED_BY_SERIES",
        },
        { status: 400 }
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无有效字段" }, { status: 400 });
  }

  const updated = await prisma.project.update({
    where: { id },
    data: patch,
  });

  await logUserAction({
    userId: session.user.id,
    category: "project",
    action: "project.update",
    targetType: "Project",
    targetId: id,
    projectId: id,
    route: `/api/projects/${id}`,
    metadata: {
      patch,
    },
  });

  return NextResponse.json(updated);
}
