-- ProviderCredential: admin 维护的共享凭据，按 provider 类型分组（v1.3.0 起替代 GlobalConfig 的 ${purpose}_* 凭据键）
CREATE TABLE "ProviderCredential" (
  "id"          TEXT NOT NULL,
  "provider"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "baseUrl"     TEXT NOT NULL,
  "apiKey"      TEXT NOT NULL,
  "deployment"  TEXT,
  "apiVersion"  TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "isPrimary"   BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"   INTEGER NOT NULL DEFAULT 100,
  "remark"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderCredential_provider_isActive_idx"
  ON "ProviderCredential"("provider", "isActive");

CREATE INDEX "ProviderCredential_provider_isPrimary_idx"
  ON "ProviderCredential"("provider", "isPrimary");

-- UserApiConfig: 增加 credentialId 可选外键，允许用户级配置引用共享凭据
ALTER TABLE "UserApiConfig"
  ADD COLUMN "credentialId" TEXT;

CREATE INDEX "UserApiConfig_credentialId_idx"
  ON "UserApiConfig"("credentialId");

ALTER TABLE "UserApiConfig"
  ADD CONSTRAINT "UserApiConfig_credentialId_fkey"
    FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
