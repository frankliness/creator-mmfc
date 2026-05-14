-- Add fine-grained permission matrix and soft-delete for AdminUser
ALTER TABLE "AdminUser" ADD COLUMN "permissions" JSONB;
ALTER TABLE "AdminUser" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Help filter live admins (deletedAt IS NULL) on login/refresh/profile
CREATE INDEX "AdminUser_deletedAt_idx" ON "AdminUser"("deletedAt");
