-- 邮箱验证码模块
-- 注册 / 忘记密码两个流程引入 6 位数字验证码。
-- - User.emailVerified：null = 历史用户或未验证；新注册流程通过验证码后置为 now()
-- - EmailVerificationCode：codeHash 存 bcrypt 哈希，10 分钟过期，>=5 次校验失败视为失效

ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3);

CREATE TYPE "EmailVerificationCodePurpose" AS ENUM ('REGISTER', 'RESET_PASSWORD');

CREATE TABLE "EmailVerificationCode" (
  "id"         TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "purpose"    "EmailVerificationCodePurpose" NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerificationCode_email_purpose_createdAt_idx"
  ON "EmailVerificationCode" ("email", "purpose", "createdAt");

CREATE INDEX "EmailVerificationCode_expiresAt_idx"
  ON "EmailVerificationCode" ("expiresAt");
