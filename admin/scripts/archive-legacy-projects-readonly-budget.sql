-- Archive legacy workbench projects and canvas projects into one Series with zero budgets.
--
-- Goal:
--   Stop legacy Project / CanvasProject records from creating new Seedance or Canvas image spend
--   by making them enter the existing Series budget checks with totalBudget = 0.
--
-- Safe to re-run:
--   Reuses the archive Series by name and upserts the two zero-budget rows.
--
-- Run from repo root:
--   docker compose exec -T postgres psql -U postgres -d seedance \
--     < admin/scripts/archive-legacy-projects-readonly-budget.sql

BEGIN;

DO $$
DECLARE
  archive_series_id text;
  migrated_project_count integer;
  migrated_canvas_count integer;
BEGIN
  SELECT id
    INTO archive_series_id
  FROM "Series"
  WHERE name = '历史归档（禁用预算）'
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF archive_series_id IS NULL THEN
    archive_series_id := gen_random_uuid()::text;

    INSERT INTO "Series" (
      id,
      name,
      description,
      "ownerId",
      status,
      "defaultStyle",
      "defaultRatio",
      "defaultResolution",
      "defaultSeed",
      "createdBy",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      archive_series_id,
      '历史归档（禁用预算）',
      '自动归档 legacy Project / CanvasProject；预算为 0，用于禁止新增 Seedance / Canvas 生图消耗。',
      NULL,
      'LOCKED',
      '',
      '9:16',
      '720p',
      0,
      'system',
      now(),
      now()
    );
  ELSE
    UPDATE "Series"
    SET status = 'LOCKED',
        description = COALESCE(
          description,
          '自动归档 legacy Project / CanvasProject；预算为 0，用于禁止新增 Seedance / Canvas 生图消耗。'
        ),
        "updatedAt" = now()
    WHERE id = archive_series_id;
  END IF;

  INSERT INTO "ProjectMember" (
    id,
    "seriesId",
    "userId",
    role,
    status,
    "createdBy",
    "createdAt",
    "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    archive_series_id,
    legacy_users."userId",
    'VIEWER',
    'ACTIVE',
    'system',
    now(),
    now()
  FROM (
    SELECT DISTINCT "userId"
    FROM "Project"
    WHERE "seriesId" IS NULL

    UNION

    SELECT DISTINCT "userId"
    FROM "CanvasProject"
    WHERE "seriesId" IS NULL
      AND status <> 'DELETED'
  ) AS legacy_users
  ON CONFLICT ("seriesId", "userId")
  DO UPDATE SET
    role = 'VIEWER',
    status = 'ACTIVE',
    "updatedAt" = now();

  UPDATE "Project"
  SET "seriesId" = archive_series_id,
      "lockedReason" = COALESCE("lockedReason", '历史项目已归档，已禁用新增预算消耗'),
      "updatedAt" = now()
  WHERE "seriesId" IS NULL;
  GET DIAGNOSTICS migrated_project_count = ROW_COUNT;

  UPDATE "CanvasProject"
  SET "seriesId" = archive_series_id,
      "updatedAt" = now()
  WHERE "seriesId" IS NULL
    AND status <> 'DELETED';
  GET DIAGNOSTICS migrated_canvas_count = ROW_COUNT;

  INSERT INTO "SeriesResourceBudget" (
    id,
    "seriesId",
    provider,
    "modelKey",
    "budgetScope",
    "metricType",
    "totalBudget",
    "committedUsage",
    "reservedUsage",
    "unallocatedBudget",
    "isHardCap",
    status,
    "createdBy",
    "createdAt",
    "updatedAt"
  )
  VALUES
    (
      gen_random_uuid()::text,
      archive_series_id,
      'seedance',
      '*',
      'video_generation',
      'TOKEN',
      0,
      0,
      0,
      0,
      true,
      'ACTIVE',
      'system',
      now(),
      now()
    ),
    (
      gen_random_uuid()::text,
      archive_series_id,
      'canvas',
      '*',
      'canvas_image_generation',
      'SUCCESS_COUNT',
      0,
      0,
      0,
      0,
      true,
      'ACTIVE',
      'system',
      now(),
      now()
    )
  ON CONFLICT ("seriesId", provider, "modelKey", "budgetScope", "metricType")
  DO UPDATE SET
    "totalBudget" = 0,
    "unallocatedBudget" = 0,
    "isHardCap" = true,
    status = 'ACTIVE',
    "updatedAt" = now();

  INSERT INTO "BudgetEvent" (
    id,
    "seriesId",
    "seriesBudgetId",
    type,
    "metricType",
    amount,
    "beforeBudget",
    "afterBudget",
    "beforeUnallocated",
    "afterUnallocated",
    "operatorId",
    "operatorRole",
    reason,
    "metadata",
    "createdAt"
  )
  SELECT
    gen_random_uuid()::text,
    b."seriesId",
    b.id,
    'ADMIN_ADJUST_DECREASE',
    b."metricType",
    0,
    b."totalBudget",
    0,
    b."unallocatedBudget",
    0,
    'system',
    'ADMIN',
    '历史 legacy 项目归档，预算置 0',
    jsonb_build_object(
      'archiveSeriesId', archive_series_id,
      'migratedProjects', migrated_project_count,
      'migratedCanvasProjects', migrated_canvas_count
    ),
    now()
  FROM "SeriesResourceBudget" b
  WHERE b."seriesId" = archive_series_id
    AND (
      (b.provider = 'seedance'
       AND b."modelKey" = '*'
       AND b."budgetScope" = 'video_generation'
       AND b."metricType" = 'TOKEN')
      OR
      (b.provider = 'canvas'
       AND b."modelKey" = '*'
       AND b."budgetScope" = 'canvas_image_generation'
       AND b."metricType" = 'SUCCESS_COUNT')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "BudgetEvent" e
      WHERE e."seriesBudgetId" = b.id
        AND e.reason = '历史 legacy 项目归档，预算置 0'
    );

  RAISE NOTICE 'archive_series_id=% migrated_projects=% migrated_canvas_projects=%',
    archive_series_id,
    migrated_project_count,
    migrated_canvas_count;
END $$;

COMMIT;
