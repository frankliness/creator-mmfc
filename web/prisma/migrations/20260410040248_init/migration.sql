-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'GENERATING_STORYBOARDS', 'REVIEW', 'GENERATING_VIDEOS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoryboardStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUBMITTED', 'GENERATING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PERSISTING', 'PERSISTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

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

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyboard" ADD CONSTRAINT "Storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
