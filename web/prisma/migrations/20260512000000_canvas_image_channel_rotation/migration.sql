-- 画布生图渠道轮询 v1.5.0
-- 目标：支持多 Azure / OpenAI 凭据按"每渠道并发"轮询，命中 429 时退回 PENDING 让其他渠道接手。
-- 新增字段全部带默认值，老数据回填后语义与旧版一致（rotation 默认开但不影响 bypassRotation=false 老任务）。

-- 渠道维度：每渠道并发上限 + 限流冷却到期时间
ALTER TABLE "ProviderCredential"
  ADD COLUMN "concurrency"   INTEGER   NOT NULL DEFAULT 6,
  ADD COLUMN "cooldownUntil" TIMESTAMP(3);

CREATE INDEX "ProviderCredential_isActive_cooldownUntil_idx"
  ON "ProviderCredential" ("isActive", "cooldownUntil");

-- 任务维度：失败原因、绕过轮询标记、限流回退累计次数
ALTER TABLE "CanvasImageTask"
  ADD COLUMN "failureKind"     TEXT,
  ADD COLUMN "bypassRotation"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "cooldownRetries" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "CanvasImageTask_credentialId_finishedAt_idx"
  ON "CanvasImageTask" ("credentialId", "finishedAt");

-- 审计日志：补 credentialId 用于渠道看板聚合（status 已是 TEXT，扩展值集合无需 schema 变更）
ALTER TABLE "CanvasAiCall"
  ADD COLUMN "credentialId" TEXT;

CREATE INDEX "CanvasAiCall_credentialId_createdAt_idx"
  ON "CanvasAiCall" ("credentialId", "createdAt");
