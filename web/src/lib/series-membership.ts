/**
 * v1.9.0 Series 成员鉴权工具。
 *
 * 所有路由必须实时查 ProjectMember 表（不缓存）。
 * 抛出 SeriesAccessError，调用方负责映射到 HTTP 响应。
 */
import { prisma } from "./prisma";

export type MemberRole = "OWNER" | "PRODUCER" | "VIEWER";

export class SeriesAccessError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getMembership(
  userId: string,
  seriesId: string,
): Promise<{ role: MemberRole; status: string } | null> {
  const m = await prisma.projectMember.findUnique({
    where: { seriesId_userId: { seriesId, userId } },
  });
  if (!m || m.status !== "ACTIVE") return null;
  return { role: m.role as MemberRole, status: m.status };
}

export async function assertSeriesMember(
  userId: string,
  seriesId: string,
  requiredRoles?: MemberRole[],
): Promise<{ role: MemberRole }> {
  const m = await getMembership(userId, seriesId);
  if (!m) {
    throw new SeriesAccessError(403, "NOT_A_MEMBER", "你不是该项目的成员");
  }
  if (requiredRoles && !requiredRoles.includes(m.role)) {
    throw new SeriesAccessError(
      403,
      "ROLE_FORBIDDEN",
      `需要角色 ${requiredRoles.join("/")}，当前为 ${m.role}`,
    );
  }
  return { role: m.role };
}

/** 集数级访问：legacy（seriesId=null）→ 必须是 project.userId 本人；Series 项目 → 走 ProjectMember。 */
export async function assertEpisodeAccess(
  userId: string,
  projectId: string,
  action: "read" | "write",
): Promise<{
  role: MemberRole | "LEGACY_OWNER";
  project: {
    id: string;
    userId: string;
    seriesId: string | null;
    lockedReason: string | null;
  };
}> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, seriesId: true, lockedReason: true },
  });
  if (!project) {
    throw new SeriesAccessError(404, "PROJECT_NOT_FOUND", "集数不存在");
  }
  if (!project.seriesId) {
    // legacy 路径
    if (project.userId !== userId) {
      throw new SeriesAccessError(403, "NOT_OWNER", "无权访问该项目");
    }
    return { role: "LEGACY_OWNER", project };
  }
  const m = await getMembership(userId, project.seriesId);
  if (!m) {
    throw new SeriesAccessError(403, "NOT_A_MEMBER", "你不是该项目的成员");
  }
  if (action === "write") {
    if (m.role === "VIEWER") {
      throw new SeriesAccessError(403, "READ_ONLY", "你是 VIEWER，不可写入");
    }
    if (project.lockedReason) {
      throw new SeriesAccessError(423, "EPISODE_LOCKED", `该集数已被锁定：${project.lockedReason}`);
    }
  }
  return { role: m.role, project };
}

export async function listAccessibleSeriesIds(userId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { seriesId: true },
  });
  return rows.map((r) => r.seriesId);
}

export async function listAccessibleProjectIds(userId: string): Promise<string[]> {
  const [legacy, seriesIds] = await Promise.all([
    prisma.project.findMany({
      where: { userId, seriesId: null },
      select: { id: true },
    }),
    listAccessibleSeriesIds(userId),
  ]);
  const seriesProjects = seriesIds.length
    ? await prisma.project.findMany({
        where: { seriesId: { in: seriesIds } },
        select: { id: true },
      })
    : [];
  return [...legacy.map((p) => p.id), ...seriesProjects.map((p) => p.id)];
}

/** 校验某 CanvasProject 是否对当前 user 可访问。 */
export async function assertCanvasProjectAccess(
  userId: string,
  canvasProjectId: string,
  action: "read" | "write" = "write",
): Promise<{
  role: MemberRole | "LEGACY_OWNER";
  canvasProject: { id: string; userId: string; seriesId: string | null };
}> {
  const cp = await prisma.canvasProject.findUnique({
    where: { id: canvasProjectId },
    select: { id: true, userId: true, seriesId: true },
  });
  if (!cp) throw new SeriesAccessError(404, "CANVAS_NOT_FOUND", "画布项目不存在");
  if (!cp.seriesId) {
    if (cp.userId !== userId) throw new SeriesAccessError(403, "NOT_OWNER", "无权访问该画布");
    return { role: "LEGACY_OWNER", canvasProject: cp };
  }
  const m = await getMembership(userId, cp.seriesId);
  if (!m) throw new SeriesAccessError(403, "NOT_A_MEMBER", "你不是该项目的成员");
  if (action === "write" && m.role === "VIEWER") {
    throw new SeriesAccessError(403, "READ_ONLY", "你是 VIEWER，不可写入");
  }
  return { role: m.role, canvasProject: cp };
}
