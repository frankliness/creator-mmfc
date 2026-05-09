-- Scope ProviderCredential matching by business purpose and optionally model key.
-- Existing credentials are marked as all-purpose for backward compatibility;
-- admins can narrow image/chat credentials in the credential pool UI.
ALTER TABLE "ProviderCredential"
  ADD COLUMN "purposes" JSONB,
  ADD COLUMN "modelKeys" JSONB;

UPDATE "ProviderCredential"
SET "purposes" = '["chat","storyboard","canvas_image","canvas_image_edit"]'::jsonb
WHERE "purposes" IS NULL;
