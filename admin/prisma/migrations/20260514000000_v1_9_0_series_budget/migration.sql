-- v1.9.0 Series / 资源预算 / 项目成员
-- 1) User 扩展：自建权限标志
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canSelfCreateProject" BOOLEAN NOT NULL DEFAULT false;
-- 历史用户视为 legacy，保留自建权限
UPDATE "User" SET "canSelfCreateProject" = true;

-- 2) Project 扩展：Series / Episode 字段
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "episodeNumber" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "episodeTitle" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "assigneeId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lockedReason" TEXT;
CREATE INDEX IF NOT EXISTS "Project_seriesId_idx" ON "Project"("seriesId");

-- 3) CanvasProject 扩展：Series 绑定
ALTER TABLE "CanvasProject" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
CREATE INDEX IF NOT EXISTS "CanvasProject_seriesId_idx" ON "CanvasProject"("seriesId");

-- 4) TokenUsageLog 扩展：预算追踪
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "seriesBudgetId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "storyboardId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "generationTaskId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "canvasProjectId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "canvasImageTaskId" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "metricType" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "budgetScope" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "actualCallType" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "estimateTokens" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "actualTokens" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "reservedAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "committedAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'FINALIZED';
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "TokenUsageLog" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "TokenUsageLog_idempotencyKey_key" ON "TokenUsageLog"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "TokenUsageLog_seriesId_createdAt_idx" ON "TokenUsageLog"("seriesId","createdAt");
CREATE INDEX IF NOT EXISTS "TokenUsageLog_seriesBudgetId_idx" ON "TokenUsageLog"("seriesBudgetId");
CREATE INDEX IF NOT EXISTS "TokenUsageLog_status_idx" ON "TokenUsageLog"("status");
CREATE INDEX IF NOT EXISTS "TokenUsageLog_generationTaskId_idx" ON "TokenUsageLog"("generationTaskId");
CREATE INDEX IF NOT EXISTS "TokenUsageLog_canvasImageTaskId_idx" ON "TokenUsageLog"("canvasImageTaskId");

-- 5) Series 表
CREATE TABLE IF NOT EXISTS "Series" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "ownerId"     TEXT,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Series_ownerId_idx" ON "Series"("ownerId");
CREATE INDEX IF NOT EXISTS "Series_status_idx" ON "Series"("status");

-- 6) ProjectMember
CREATE TABLE IF NOT EXISTS "ProjectMember" (
  "id"        TEXT NOT NULL,
  "seriesId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "role"      TEXT NOT NULL DEFAULT 'PRODUCER',
  "status"    TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_seriesId_userId_key" ON "ProjectMember"("seriesId","userId");
CREATE INDEX IF NOT EXISTS "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE INDEX IF NOT EXISTS "ProjectMember_seriesId_idx" ON "ProjectMember"("seriesId");
CREATE INDEX IF NOT EXISTS "ProjectMember_userId_status_idx" ON "ProjectMember"("userId","status");

-- 7) ProjectMemberEpisodeOverride
CREATE TABLE IF NOT EXISTS "ProjectMemberEpisodeOverride" (
  "id"         TEXT NOT NULL,
  "seriesId"   TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "grantedBy"  TEXT,
  "reason"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMemberEpisodeOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMemberEpisodeOverride_projectId_userId_permission_key"
  ON "ProjectMemberEpisodeOverride"("projectId","userId","permission");
CREATE INDEX IF NOT EXISTS "ProjectMemberEpisodeOverride_seriesId_userId_idx" ON "ProjectMemberEpisodeOverride"("seriesId","userId");
CREATE INDEX IF NOT EXISTS "ProjectMemberEpisodeOverride_projectId_idx" ON "ProjectMemberEpisodeOverride"("projectId");

-- 8) SeriesResourceBudget
CREATE TABLE IF NOT EXISTS "SeriesResourceBudget" (
  "id"                TEXT NOT NULL,
  "seriesId"          TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "modelKey"          TEXT NOT NULL,
  "budgetScope"       TEXT NOT NULL,
  "metricType"        TEXT NOT NULL,
  "totalBudget"       BIGINT NOT NULL DEFAULT 0,
  "committedUsage"    BIGINT NOT NULL DEFAULT 0,
  "reservedUsage"     BIGINT NOT NULL DEFAULT 0,
  "unallocatedBudget" BIGINT NOT NULL DEFAULT 0,
  "isHardCap"         BOOLEAN NOT NULL DEFAULT true,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesResourceBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeriesResourceBudget_seriesId_provider_modelKey_budgetScope_metricType_key"
  ON "SeriesResourceBudget"("seriesId","provider","modelKey","budgetScope","metricType");
CREATE INDEX IF NOT EXISTS "SeriesResourceBudget_seriesId_idx" ON "SeriesResourceBudget"("seriesId");
CREATE INDEX IF NOT EXISTS "SeriesResourceBudget_seriesId_budgetScope_modelKey_idx" ON "SeriesResourceBudget"("seriesId","budgetScope","modelKey");
CREATE INDEX IF NOT EXISTS "SeriesResourceBudget_status_idx" ON "SeriesResourceBudget"("status");

-- 9) ProjectResourceAllocation
CREATE TABLE IF NOT EXISTS "ProjectResourceAllocation" (
  "id"              TEXT NOT NULL,
  "seriesBudgetId"  TEXT NOT NULL,
  "seriesId"        TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "allocatedBudget" BIGINT NOT NULL DEFAULT 0,
  "committedUsage"  BIGINT NOT NULL DEFAULT 0,
  "reservedUsage"   BIGINT NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectResourceAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectResourceAllocation_seriesBudgetId_projectId_key"
  ON "ProjectResourceAllocation"("seriesBudgetId","projectId");
CREATE INDEX IF NOT EXISTS "ProjectResourceAllocation_seriesId_projectId_idx" ON "ProjectResourceAllocation"("seriesId","projectId");
CREATE INDEX IF NOT EXISTS "ProjectResourceAllocation_projectId_idx" ON "ProjectResourceAllocation"("projectId");

-- 10) BudgetEvent
CREATE TABLE IF NOT EXISTS "BudgetEvent" (
  "id"                TEXT NOT NULL,
  "seriesId"          TEXT NOT NULL,
  "seriesBudgetId"    TEXT,
  "projectId"         TEXT,
  "type"              TEXT NOT NULL,
  "metricType"        TEXT,
  "amount"            BIGINT NOT NULL,
  "beforeBudget"      BIGINT,
  "afterBudget"       BIGINT,
  "beforeUnallocated" BIGINT,
  "afterUnallocated"  BIGINT,
  "operatorId"        TEXT,
  "operatorRole"      TEXT,
  "reason"            TEXT,
  "metadata"          JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BudgetEvent_seriesId_createdAt_idx" ON "BudgetEvent"("seriesId","createdAt");
CREATE INDEX IF NOT EXISTS "BudgetEvent_seriesBudgetId_createdAt_idx" ON "BudgetEvent"("seriesBudgetId","createdAt");
CREATE INDEX IF NOT EXISTS "BudgetEvent_projectId_createdAt_idx" ON "BudgetEvent"("projectId","createdAt");
CREATE INDEX IF NOT EXISTS "BudgetEvent_type_createdAt_idx" ON "BudgetEvent"("type","createdAt");

-- 11) GlobalConfig 全局开关默认值（共享数据库，admin/web 共用）
INSERT INTO "GlobalConfig" ("id","key","value","encrypted","remark","updatedAt")
SELECT gen_random_uuid()::text, 'allow_user_self_create_project', 'false', false,
       'v1.9.0 全局允许所有用户自建 Project（true 时覆盖 User.canSelfCreateProject）', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "GlobalConfig" WHERE "key" = 'allow_user_self_create_project');
INSERT INTO "GlobalConfig" ("id","key","value","encrypted","remark","updatedAt")
SELECT gen_random_uuid()::text, 'seedance_default_frame_rate', '24', false,
       'v1.9.0 Seedance token 估算默认帧率', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "GlobalConfig" WHERE "key" = 'seedance_default_frame_rate');
