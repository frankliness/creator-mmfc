import { NextRequest, NextResponse } from "next/server";
import { hash, compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logUserAction } from "@/lib/user-action-logger";

const schema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "参数错误", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { oldPassword, newPassword } = parsed.data;
    if (oldPassword === newPassword) {
      return NextResponse.json(
        { error: "新密码不能与旧密码相同" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    const ok = await compare(oldPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "旧密码不正确" }, { status: 400 });
    }

    const passwordHash = await hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await logUserAction({
      userId: user.id,
      category: "auth",
      action: "auth.password.change",
      targetType: "User",
      targetId: user.id,
      route: "/api/auth/change-password",
      metadata: { email: user.email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("change-password error:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
