-- v1.9.1: Series global defaults (style/ratio/resolution/seed)
ALTER TABLE "Series"
  ADD COLUMN IF NOT EXISTS "defaultStyle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "defaultRatio" TEXT NOT NULL DEFAULT '9:16',
  ADD COLUMN IF NOT EXISTS "defaultResolution" TEXT NOT NULL DEFAULT '720p',
  ADD COLUMN IF NOT EXISTS "defaultSeed" INTEGER NOT NULL DEFAULT 0;
