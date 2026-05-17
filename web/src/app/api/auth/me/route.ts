import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/auth/me — 当前会话用户的基本信息 + v1.9.0 自建权限标志。 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const [user, gc] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, canSelfCreateProject: true, status: true },
    }),
    prisma.globalConfig.findUnique({ where: { key: "allow_user_self_create_project" } }),
  ]);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  const globalSelfCreateAllowed = gc?.value === "true";
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    canSelfCreateProject: user.canSelfCreateProject,
    globalSelfCreateAllowed,
    effectiveCanSelfCreate: user.canSelfCreateProject || globalSelfCreateAllowed,
  });
}
