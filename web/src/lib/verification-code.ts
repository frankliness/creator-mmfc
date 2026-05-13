import { hash, compare } from "bcryptjs";
import { prisma } from "./prisma";
import type { EmailVerificationCodePurpose } from "@prisma/client";

export const CODE_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_VERIFY_ATTEMPTS = 5;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateCode(): string {
  // 6 位数字，首位不为 0 视觉更稳定
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

/**
 * 创建一条新验证码记录，返回明文 code 供调用方发邮件。
 * 同一 (email, purpose) 60 秒内不允许重复发送，违反时抛错。
 */
export async function issueVerificationCode(args: {
  email: string;
  purpose: EmailVerificationCodePurpose;
}): Promise<{ code: string; expiresAt: Date }> {
  const email = normalizeEmail(args.email);
  const { purpose } = args;

  const recent = await prisma.emailVerificationCode.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    const elapsedMs = Date.now() - recent.createdAt.getTime();
    if (elapsedMs < RESEND_COOLDOWN_SECONDS * 1000) {
      const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000);
      const err = new Error(`请求过于频繁，请 ${wait} 秒后再试`);
      (err as Error & { code?: string }).code = "RATE_LIMITED";
      throw err;
    }
  }

  const code = generateCode();
  const codeHash = await hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await prisma.emailVerificationCode.create({
    data: { email, purpose, codeHash, expiresAt },
  });

  return { code, expiresAt };
}

/**
 * 核销验证码：必须未过期、未被使用、未超过最大尝试次数。
 * 失败时 attempts +1。成功时 consumedAt 置为 now。
 * 返回 true 表示通过。
 */
export async function consumeVerificationCode(args: {
  email: string;
  purpose: EmailVerificationCodePurpose;
  code: string;
}): Promise<boolean> {
  const email = normalizeEmail(args.email);
  const { purpose, code } = args;

  const record = await prisma.emailVerificationCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return false;
  if (record.expiresAt.getTime() < Date.now()) return false;
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) return false;

  const ok = await compare(code, record.codeHash);
  if (!ok) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  await prisma.emailVerificationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return true;
}
