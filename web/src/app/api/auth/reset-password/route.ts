import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logUserAction } from "@/lib/user-action-logger";
import {
  consumeVerificationCode,
  normalizeEmail,
} from "@/lib/verification-code";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "验证码应为 6 位数字"),
  newPassword: z.string().min(6),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "参数错误", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { code, newPassword } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: "验证码无效或已过期" },
        { status: 400 }
      );
    }

    const codeOk = await consumeVerificationCode({
      email,
      purpose: "RESET_PASSWORD",
      code,
    });
    if (!codeOk) {
      return NextResponse.json(
        { error: "验证码无效或已过期" },
        { status: 400 }
      );
    }

    const passwordHash = await hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await logUserAction({
      userId: user.id,
      category: "auth",
      action: "auth.password.reset",
      targetType: "User",
      targetId: user.id,
      route: "/api/auth/reset-password",
      metadata: { email: user.email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reset-password error:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
