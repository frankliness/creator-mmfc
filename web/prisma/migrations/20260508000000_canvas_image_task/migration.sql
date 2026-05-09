-- CanvasImageTask: 画布图片生成异步任务（v1.4.0）
-- 状态机：PENDING → RUNNING → SUCCEEDED / FAILED
-- 长 fetch（gpt-image-1 / 慢 Gemini）由 Worker 执行；前端轮询 /api/canvas/images/tasks/:id 恢复结果
CREATE TABLE "CanvasImageTask" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "projectId"         TEXT NOT NULL,
  "sourceNodeId"      TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "callType"          TEXT NOT NULL,
  "model"             TEXT NOT NULL,
  "credentialId"      TEXT,
  "prompt"            TEXT NOT NULL,
  "size"              TEXT,
  "quality"           TEXT,
  "isEdit"            BOOLEAN NOT NULL DEFAULT false,
  "refImagesSnapshot" JSONB,
  "upstreamProvider"  TEXT,
  "resultAssetIds"    JSONB,
  "revisedPrompt"     TEXT,
  "costEstimate"      DECIMAL(10,6),
  "durationMs"        INTEGER,
  "error"             TEXT,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "startedAt"         TIMESTAMP(3),
  "finishedAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasImageTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CanvasImageTask_userId_status_idx"
  ON "CanvasImageTask"("userId", "status");

CREATE INDEX "CanvasImageTask_projectId_status_createdAt_idx"
  ON "CanvasImageTask"("projectId", "status", "createdAt");

CREATE INDEX "CanvasImageTask_status_createdAt_idx"
  ON "CanvasImageTask"("status", "createdAt");

ALTER TABLE "CanvasImageTask"
  ADD CONSTRAINT "CanvasImageTask_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CanvasImageTask"
  ADD CONSTRAINT "CanvasImageTask_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
