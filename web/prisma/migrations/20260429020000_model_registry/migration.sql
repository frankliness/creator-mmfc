-- ModelRegistry: admin 可注册/启停的模型清单，画布前端动态读取
CREATE TABLE "ModelRegistry" (
  "id"            TEXT NOT NULL,
  "modelKey"      TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "providers"     JSONB NOT NULL,
  "capabilities"  JSONB NOT NULL,
  "sizes"         JSONB,
  "qualities"     JSONB,
  "defaultParams" JSONB,
  "tips"          TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 100,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- 同一 modelKey 在不同 category 下可独立注册（如 gpt-image-1 同时在 canvas_image / canvas_image_edit）
CREATE UNIQUE INDEX "ModelRegistry_modelKey_category_key"
  ON "ModelRegistry"("modelKey", "category");

CREATE INDEX "ModelRegistry_category_isActive_sortOrder_idx"
  ON "ModelRegistry"("category", "isActive", "sortOrder");
