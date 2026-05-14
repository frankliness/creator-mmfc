-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmailVerificationCodePurpose" AS ENUM ('REGISTER', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "ProjectCreationMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'GENERATING_STORYBOARDS', 'REVIEW', 'GENERATING_VIDEOS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoryboardStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PERSISTING', 'PERSISTED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('SYSTEM_PROMPT', 'JSON_SCHEMA', 'USER_PROMPT');

-- CreateEnum
CREATE TYPE "CanvasStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "CanvasAssetKind" AS ENUM ('GENERATED_IMAGE', 'UPLOADED_IMAGE', 'GENERATED_VIDEO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "quota" JSONB,
    "remark" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "EmailVerificationCodePurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "fullScript" TEXT NOT NULL,
    "assetsJson" JSONB NOT NULL,
    "assetDescriptions" JSONB NOT NULL,
    "style" TEXT NOT NULL,
    "ratio" TEXT NOT NULL DEFAULT '9:16',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "seedanceEndpoint" TEXT NOT NULL DEFAULT '',
    "globalSeed" INTEGER NOT NULL DEFAULT 0,
    "creationMode" "ProjectCreationMode" NOT NULL DEFAULT 'AUTO',
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "seed" INTEGER,
    "prompt" TEXT NOT NULL,
    "assetBindings" JSONB NOT NULL,
    "seedanceContentItems" JSONB NOT NULL,
    "status" "StoryboardStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "arkTaskId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'SUBMITTED',
    "arkStatus" TEXT,
    "videoUrl" TEXT,
    "localVideoPath" TEXT,
    "gcsVideoPath" TEXT,
    "seed" BIGINT,
    "resolution" TEXT,
    "ratio" TEXT,
    "duration" INTEGER,
    "completionTokens" BIGINT,
    "totalTokens" BIGINT,
    "error" TEXT,
    "apiConfigId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApiConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT,
    "callType" TEXT NOT NULL DEFAULT 'video',
    "deployment" TEXT,
    "apiVersion" TEXT,
    "credentialId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "deployment" TEXT,
    "apiVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "purposes" JSONB,
    "modelKeys" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "remark" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 6,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "providers" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "sizes" JSONB,
    "qualities" JSONB,
    "defaultParams" JSONB,
    "tips" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "totalTokens" BIGINT NOT NULL DEFAULT 0,
    "costEstimate" DECIMAL(10,6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "projectId" TEXT,
    "storyboardId" TEXT,
    "taskId" TEXT,
    "route" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "PromptCategory" NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "applicableProviders" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail" TEXT,
    "viewport" JSONB NOT NULL DEFAULT '{"x":100,"y":50,"zoom":0.8}',
    "status" "CanvasStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasNode_pkey" PRIMARY KEY ("projectId","id")
);

-- CreateTable
CREATE TABLE "CanvasEdge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "targetHandle" TEXT,
    "type" TEXT,
    "data" JSONB,

    CONSTRAINT "CanvasEdge_pkey" PRIMARY KEY ("projectId","id")
);

-- CreateTable
CREATE TABLE "CanvasAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CanvasAssetKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "localPath" TEXT,
    "gcsPath" TEXT,
    "publicUrl" TEXT,
    "sourceNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasAiCall" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini-canvas',
    "model" TEXT NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "totalTokens" BIGINT NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "costEstimate" DECIMAL(10,6),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasAiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasImageTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "callType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "credentialId" TEXT,
    "prompt" TEXT NOT NULL,
    "size" TEXT,
    "quality" TEXT,
    "isEdit" BOOLEAN NOT NULL DEFAULT false,
    "refImagesSnapshot" JSONB,
    "upstreamProvider" TEXT,
    "resultAssetIds" JSONB,
    "revisedPrompt" TEXT,
    "costEstimate" DECIMAL(10,6),
    "durationMs" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureKind" TEXT,
    "bypassRotation" BOOLEAN NOT NULL DEFAULT false,
    "cooldownRetries" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasImageTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_email_purpose_createdAt_idx" ON "EmailVerificationCode"("email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_expiresAt_idx" ON "EmailVerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Storyboard_projectId_idx" ON "Storyboard"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_arkTaskId_key" ON "GenerationTask"("arkTaskId");

-- CreateIndex
CREATE INDEX "GenerationTask_storyboardId_idx" ON "GenerationTask"("storyboardId");

-- CreateIndex
CREATE INDEX "GenerationTask_status_idx" ON "GenerationTask"("status");

-- CreateIndex
CREATE INDEX "GenerationTask_apiConfigId_idx" ON "GenerationTask"("apiConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE INDEX "UserApiConfig_userId_idx" ON "UserApiConfig"("userId");

-- CreateIndex
CREATE INDEX "UserApiConfig_userId_provider_idx" ON "UserApiConfig"("userId", "provider");

-- CreateIndex
CREATE INDEX "UserApiConfig_userId_callType_isDefault_idx" ON "UserApiConfig"("userId", "callType", "isDefault");

-- CreateIndex
CREATE INDEX "UserApiConfig_credentialId_idx" ON "UserApiConfig"("credentialId");

-- CreateIndex
CREATE INDEX "ProviderCredential_provider_isActive_idx" ON "ProviderCredential"("provider", "isActive");

-- CreateIndex
CREATE INDEX "ProviderCredential_provider_isPrimary_idx" ON "ProviderCredential"("provider", "isPrimary");

-- CreateIndex
CREATE INDEX "ProviderCredential_isActive_cooldownUntil_idx" ON "ProviderCredential"("isActive", "cooldownUntil");

-- CreateIndex
CREATE INDEX "ModelRegistry_category_isActive_sortOrder_idx" ON "ModelRegistry"("category", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistry_modelKey_category_key" ON "ModelRegistry"("modelKey", "category");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalConfig_key_key" ON "GlobalConfig"("key");

-- CreateIndex
CREATE INDEX "TokenUsageLog_userId_idx" ON "TokenUsageLog"("userId");

-- CreateIndex
CREATE INDEX "TokenUsageLog_userId_provider_idx" ON "TokenUsageLog"("userId", "provider");

-- CreateIndex
CREATE INDEX "TokenUsageLog_createdAt_idx" ON "TokenUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "TokenUsageLog_userId_createdAt_idx" ON "TokenUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActionLog_userId_idx" ON "UserActionLog"("userId");

-- CreateIndex
CREATE INDEX "UserActionLog_category_idx" ON "UserActionLog"("category");

-- CreateIndex
CREATE INDEX "UserActionLog_action_idx" ON "UserActionLog"("action");

-- CreateIndex
CREATE INDEX "UserActionLog_targetType_idx" ON "UserActionLog"("targetType");

-- CreateIndex
CREATE INDEX "UserActionLog_projectId_idx" ON "UserActionLog"("projectId");

-- CreateIndex
CREATE INDEX "UserActionLog_taskId_idx" ON "UserActionLog"("taskId");

-- CreateIndex
CREATE INDEX "UserActionLog_createdAt_idx" ON "UserActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "UserActionLog_userId_createdAt_idx" ON "UserActionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptTemplate_slug_isActive_idx" ON "PromptTemplate"("slug", "isActive");

-- CreateIndex
CREATE INDEX "PromptVersion_templateId_idx" ON "PromptVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_templateId_version_key" ON "PromptVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "CanvasProject_userId_idx" ON "CanvasProject"("userId");

-- CreateIndex
CREATE INDEX "CanvasProject_userId_updatedAt_idx" ON "CanvasProject"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CanvasNode_projectId_idx" ON "CanvasNode"("projectId");

-- CreateIndex
CREATE INDEX "CanvasEdge_projectId_idx" ON "CanvasEdge"("projectId");

-- CreateIndex
CREATE INDEX "CanvasAsset_projectId_idx" ON "CanvasAsset"("projectId");

-- CreateIndex
CREATE INDEX "CanvasAsset_userId_idx" ON "CanvasAsset"("userId");

-- CreateIndex
CREATE INDEX "CanvasAiCall_userId_createdAt_idx" ON "CanvasAiCall"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasAiCall_projectId_idx" ON "CanvasAiCall"("projectId");

-- CreateIndex
CREATE INDEX "CanvasAiCall_credentialId_createdAt_idx" ON "CanvasAiCall"("credentialId", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasImageTask_userId_status_idx" ON "CanvasImageTask"("userId", "status");

-- CreateIndex
CREATE INDEX "CanvasImageTask_projectId_status_createdAt_idx" ON "CanvasImageTask"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasImageTask_status_createdAt_idx" ON "CanvasImageTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasImageTask_credentialId_finishedAt_idx" ON "CanvasImageTask"("credentialId", "finishedAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyboard" ADD CONSTRAINT "Storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_apiConfigId_fkey" FOREIGN KEY ("apiConfigId") REFERENCES "UserApiConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiConfig" ADD CONSTRAINT "UserApiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiConfig" ADD CONSTRAINT "UserApiConfig_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsageLog" ADD CONSTRAINT "TokenUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActionLog" ADD CONSTRAINT "UserActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasProject" ADD CONSTRAINT "CanvasProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasNode" ADD CONSTRAINT "CanvasNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasEdge" ADD CONSTRAINT "CanvasEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasAsset" ADD CONSTRAINT "CanvasAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasAiCall" ADD CONSTRAINT "CanvasAiCall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasImageTask" ADD CONSTRAINT "CanvasImageTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasImageTask" ADD CONSTRAINT "CanvasImageTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

