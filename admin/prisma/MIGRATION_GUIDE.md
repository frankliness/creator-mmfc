# Admin Prisma 迁移指南

## 背景

`admin/prisma` 此前长期使用 `prisma db push`，没有版本化迁移记录。从 v1.8.0（admin 权限管理重构）起切换到 `prisma migrate` 流程。

## 目录结构

```
admin/prisma/
├── schema.prisma
├── migration_lock.toml          # 在 migrations/ 内，标记 provider=postgresql
├── seed.ts                       # 既有的初始 SUPER_ADMIN + prompt 种子
├── seeds/
│   └── backfill-permissions.ts   # 历史 ADMIN/OPERATOR 权限回填
└── migrations/
    ├── migration_lock.toml
    ├── 20260513000000_baseline_init/
    │   └── migration.sql         # 代表「切换 migrate 之前」的全量 schema
    ├── 20260513000001_admin_permissions_and_soft_delete/
    │   └── migration.sql         # AdminUser 新增 permissions + deletedAt
    ├── 20260514000000_v1_9_0_series_budget/
    │   └── migration.sql         # v1.9.0 Series + 预算池
    ├── 20260518000000_storyboard_display_name/
    │   └── migration.sql         # v1.10.0 Storyboard.displayName
    └── 20260520000000_v2_0_0_series_asset_library/
        └── migration.sql         # v2.0.0 SeriesAssetGroup + SeriesAsset + Storyboard.assetRefs/generationMode + GenerationTask 5 字段
```

## v2.0.0 迁移要点

v2.0.0 在 v1.10.0 displayName migration 之后引入素材库相关 schema：

- 新表 `SeriesAssetGroup`（Series ↔ BytePlus Group）
- 新表 `SeriesAsset`（统一资产，含 `@@unique([seriesId, normalizedName])`）
- `Storyboard` 加 `generationMode TEXT?` + `assetRefs JSONB?`（老字段 `assetBindings/seedanceContentItems` 保留）
- `GenerationTask` 加 `ossVideoKey/ossVideoUrl/lastFrameUrl/lastFrameAssetId/videoAssetId` 五个 TEXT 字段及对应 index

升级时确保按时间戳顺序执行：`...storyboard_display_name → v2_0_0_series_asset_library`。Web 端和 admin 端 migration SQL **完全一致**（同一份 DDL）。

## 首次接入线上环境（baselining）

线上 DB 已经包含 `20260513000000_baseline_init` 的所有表，**绝不能让 `prisma migrate deploy` 重新执行它**。一次性操作：

```bash
cd admin/server
# 1. 标记 baseline 已应用（不执行 DDL）
DATABASE_URL=<prod_url> npx prisma migrate resolve \
  --applied 20260513000000_baseline_init \
  --schema ../prisma/schema.prisma

# 2. 部署增量迁移
DATABASE_URL=<prod_url> npm run db:migrate

# 3. 重新生成 Prisma Client（新增 permissions / deletedAt 字段类型）
npm run db:generate

# 4. 回填历史账号权限
DATABASE_URL=<prod_url> npm run db:backfill-permissions
```

## 开发环境

新克隆/全新本地 DB：

```bash
cd admin/server
npm run db:migrate            # 等同 prisma migrate deploy，按顺序跑两条
npm run db:generate           # 生成 / 更新 Prisma Client
npm run db:seed               # 创建默认 admin/admin123456
npm run db:backfill-permissions   # 老库会回填；全新库 seed 出的 SUPER_ADMIN 不需回填
```

## 新增迁移

```bash
cd admin/server
DATABASE_URL=<dev_url> npx prisma migrate dev \
  --name <descriptive_name> \
  --schema ../prisma/schema.prisma
```

不要再使用 `prisma db push`。
