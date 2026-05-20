-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "assetRefs" JSONB,
ADD COLUMN     "generationMode" TEXT;

-- AlterTable
ALTER TABLE "GenerationTask" ADD COLUMN     "lastFrameAssetId" TEXT,
ADD COLUMN     "lastFrameUrl" TEXT,
ADD COLUMN     "ossVideoKey" TEXT,
ADD COLUMN     "ossVideoUrl" TEXT,
ADD COLUMN     "videoAssetId" TEXT;

-- CreateTable
CREATE TABLE "SeriesAssetGroup" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'byteplus',
    "groupId" TEXT,
    "groupName" TEXT NOT NULL,
    "groupType" TEXT NOT NULL DEFAULT 'AIGC',
    "projectName" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesAssetGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesAsset" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "projectId" TEXT,
    "storyboardId" TEXT,
    "generationTaskId" TEXT,
    "canvasProjectId" TEXT,
    "canvasAssetId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "fps" DOUBLE PRECISION,
    "ossBucket" TEXT NOT NULL,
    "ossObjectKey" TEXT NOT NULL,
    "ossPublicUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "byteplusGroupId" TEXT,
    "byteplusGroupName" TEXT,
    "byteplusAssetId" TEXT,
    "byteplusAssetName" TEXT,
    "byteplusAssetType" TEXT,
    "byteplusSyncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
    "byteplusSyncError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeriesAssetGroup_seriesId_key" ON "SeriesAssetGroup"("seriesId");

-- CreateIndex
CREATE INDEX "SeriesAssetGroup_status_idx" ON "SeriesAssetGroup"("status");

-- CreateIndex
CREATE INDEX "SeriesAssetGroup_groupId_idx" ON "SeriesAssetGroup"("groupId");

-- CreateIndex
CREATE INDEX "SeriesAsset_seriesId_type_idx" ON "SeriesAsset"("seriesId", "type");

-- CreateIndex
CREATE INDEX "SeriesAsset_seriesId_source_idx" ON "SeriesAsset"("seriesId", "source");

-- CreateIndex
CREATE INDEX "SeriesAsset_seriesId_byteplusSyncStatus_idx" ON "SeriesAsset"("seriesId", "byteplusSyncStatus");

-- CreateIndex
CREATE INDEX "SeriesAsset_byteplusAssetId_idx" ON "SeriesAsset"("byteplusAssetId");

-- CreateIndex
CREATE INDEX "SeriesAsset_generationTaskId_idx" ON "SeriesAsset"("generationTaskId");

-- CreateIndex
CREATE INDEX "SeriesAsset_canvasAssetId_idx" ON "SeriesAsset"("canvasAssetId");

-- CreateIndex
CREATE INDEX "SeriesAsset_projectId_idx" ON "SeriesAsset"("projectId");

-- CreateIndex
CREATE INDEX "SeriesAsset_storyboardId_idx" ON "SeriesAsset"("storyboardId");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesAsset_seriesId_normalizedName_key" ON "SeriesAsset"("seriesId", "normalizedName");

-- CreateIndex
CREATE INDEX "GenerationTask_videoAssetId_idx" ON "GenerationTask"("videoAssetId");

-- CreateIndex
CREATE INDEX "GenerationTask_lastFrameAssetId_idx" ON "GenerationTask"("lastFrameAssetId");

