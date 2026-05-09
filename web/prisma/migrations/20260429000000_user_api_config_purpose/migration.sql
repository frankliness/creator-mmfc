-- AlterTable: add callType / deployment / apiVersion to UserApiConfig
-- 现有记录默认是 video（Seedance），保留兼容
ALTER TABLE "UserApiConfig" ADD COLUMN "callType" TEXT NOT NULL DEFAULT 'video';
ALTER TABLE "UserApiConfig" ADD COLUMN "deployment" TEXT;
ALTER TABLE "UserApiConfig" ADD COLUMN "apiVersion" TEXT;

-- CreateIndex: 加速「用户 X 在用途 Y 下的默认配置」查询
CREATE INDEX "UserApiConfig_userId_callType_isDefault_idx" ON "UserApiConfig"("userId", "callType", "isDefault");
