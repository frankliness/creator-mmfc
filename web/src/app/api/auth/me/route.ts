import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logUserAction } from "@/lib/user-action-logger";

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

const patchSchema = z.object({
  name: z.string().trim().min(1, "昵称不能为空").max(40, "昵称最长 40 字符"),
});

/** PATCH /api/auth/me — 更新当前用户昵称。 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "参数错误" },
      { status: 400 },
    );
  }
  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
    select: { id: true, email: true, name: true },
  });
  await logUserAction({
    userId: session.user.id,
    category: "auth",
    action: "auth.profile.update",
    targetType: "User",
    targetId: session.user.id,
    route: "/api/auth/me",
    metadata: { name: parsed.data.name },
  });
  return NextResponse.json(updated);
}
