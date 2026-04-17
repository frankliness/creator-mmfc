-- Migrate existing GenerationTask token data to TokenUsageLog
-- Run this ONCE after the first admin deployment

INSERT INTO "TokenUsageLog" (id, "userId", "projectId", "taskId", provider, model, "requestType",
  "inputTokens", "outputTokens", "totalTokens", "createdAt")
SELECT
  gen_random_uuid(),
  p."userId",
  p.id,
  gt.id,
  'seedance',
  gt.model,
  'video_generation',
  0,
  COALESCE(gt."completionTokens", 0),
  COALESCE(gt."totalTokens", 0),
  gt."createdAt"
FROM "GenerationTask" gt
JOIN "Storyboard" sb ON gt."storyboardId" = sb.id
JOIN "Project" p ON sb."projectId" = p.id
WHERE gt."totalTokens" IS NOT NULL AND gt."totalTokens" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "TokenUsageLog" tul WHERE tul."taskId" = gt.id
  );
