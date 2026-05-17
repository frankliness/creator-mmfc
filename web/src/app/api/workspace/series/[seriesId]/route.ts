import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

const settingsSchema = z.object({
  defaultStyle: z.string().optional(),
  defaultRatio: z.string().optional(),
  defaultResolution: z.string().optional(),
  defaultSeed: z.number().int().min(0).max(2147483647).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  const series = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) return NextResponse.json({ error: "Series 不存在" }, { status: 404 });
  const [episodeCount, memberCount] = await Promise.all([
    prisma.project.count({ where: { seriesId } }),
    prisma.projectMember.count({ where: { seriesId, status: "ACTIVE" } }),
  ]);
  const owner = series.ownerId
    ? await prisma.user.findUnique({
        where: { id: series.ownerId },
        select: { id: true, name: true, email: true },
      })
    : null;
  return NextResponse.json({
    ...series,
    myRole: m.role,
    owner,
    episodeCount,
    memberCount,
  });
}

/**
 * v1.9.1：Series 全局默认设置（风格/画幅/分辨率/Seed）。仅导演可修改。
 * 修改后级联更新该 Series 下所有 Project 的对应字段。
 * defaultSeed=0 表示"每集随机"：级联时为每集生成新的随机 seed。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ seriesId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { seriesId } = await params;
  const m = await getMembership(session.user.id, seriesId);
  if (!m) return NextResponse.json({ error: "不是该项目的成员" }, { status: 403 });
  if (m.role !== "OWNER") {
    return NextResponse.json({ error: "仅导演可修改 Series 设置" }, { status: 403 });
  }
  const body = await req.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const series = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) return NextResponse.json({ error: "Series 不存在" }, { status: 404 });

  const patch: {
    defaultStyle?: string;
    defaultRatio?: string;
    defaultResolution?: string;
    defaultSeed?: number;
  } = {};
  if (parsed.data.defaultStyle !== undefined) patch.defaultStyle = parsed.data.defaultStyle;
  if (parsed.data.defaultRatio !== undefined) patch.defaultRatio = parsed.data.defaultRatio;
  if (parsed.data.defaultResolution !== undefined) patch.defaultResolution = parsed.data.defaultResolution;
  if (parsed.data.defaultSeed !== undefined) patch.defaultSeed = parsed.data.defaultSeed;

  // 级联到 Project
  const projects = await prisma.project.findMany({
    where: { seriesId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.series.update({ where: { id: seriesId }, data: patch });
    for (const p of projects) {
      const projectPatch: {
        style?: string;
        ratio?: string;
        resolution?: string;
        globalSeed?: number;
      } = {};
      if (patch.defaultStyle !== undefined) projectPatch.style = patch.defaultStyle;
      if (patch.defaultRatio !== undefined) projectPatch.ratio = patch.defaultRatio;
      if (patch.defaultResolution !== undefined) projectPatch.resolution = patch.defaultResolution;
      if (patch.defaultSeed !== undefined) {
        // 0 => 每集独立随机；非 0 => 全 series 统一 seed
        projectPatch.globalSeed =
          patch.defaultSeed === 0
            ? Math.floor(Math.random() * 2147483647) + 1
            : patch.defaultSeed;
      }
      if (Object.keys(projectPatch).length > 0) {
        await tx.project.update({ where: { id: p.id }, data: projectPatch });
      }
    }
    return updated;
  });

  await logUserAction({
    userId: session.user.id,
    category: "series",
    action: "series.settings.update",
    targetType: "Series",
    targetId: seriesId,
    route: `/api/workspace/series/${seriesId}`,
    metadata: { patch, cascadedProjects: projects.length },
  });

  const after = await prisma.series.findUnique({ where: { id: seriesId } });
  return NextResponse.json(after);
}
