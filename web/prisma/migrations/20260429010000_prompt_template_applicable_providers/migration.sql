-- 放开 slug 唯一约束：现在同一 slug 可有多条记录（用 applicableProviders 区分）
-- 注意：约束名 Prisma 默认生成；如名字不匹配，按你库里的实际名调整或用 db push 自动同步
ALTER TABLE "PromptTemplate" DROP CONSTRAINT IF EXISTS "PromptTemplate_slug_key";

-- 加 applicableProviders（JSON 数组）：null 表示通用，[provider..] 表示仅这些 provider 生效
ALTER TABLE "PromptTemplate" ADD COLUMN "applicableProviders" JSONB;

-- 加复合索引：lookup 时按 slug + isActive 过滤，再按 applicableProviders 在应用层选最优匹配
CREATE INDEX "PromptTemplate_slug_isActive_idx" ON "PromptTemplate"("slug", "isActive");
