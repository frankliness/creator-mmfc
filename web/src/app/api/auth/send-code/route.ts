import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CODE_TTL_MINUTES,
  issueVerificationCode,
  normalizeEmail,
} from "@/lib/verification-code";
import { sendVerificationCodeEmail } from "@/lib/mailer";

const schema = z.object({
  email: z.string().email(),
  purpose: z.enum(["REGISTER", "RESET_PASSWORD"]),
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

    const email = normalizeEmail(parsed.data.email);
    const { purpose } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });

    if (purpose === "REGISTER" && existing) {
      return NextResponse.json({ error: "邮箱已注册" }, { status: 409 });
    }

    // RESET_PASSWORD：邮箱不存在时直接返回成功，避免泄露用户是否注册
    if (purpose === "RESET_PASSWORD" && !existing) {
      return NextResponse.json({ ok: true });
    }

    let code: string;
    try {
      const issued = await issueVerificationCode({ email, purpose });
      code = issued.code;
    } catch (err) {
      if ((err as Error & { code?: string }).code === "RATE_LIMITED") {
        return NextResponse.json(
          { error: (err as Error).message },
          { status: 429 }
        );
      }
      throw err;
    }

    await sendVerificationCodeEmail({
      to: email,
      code,
      purpose,
      expiresInMinutes: CODE_TTL_MINUTES,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("send-code error:", err);
    return NextResponse.json({ error: "验证码发送失败" }, { status: 500 });
  }
}
