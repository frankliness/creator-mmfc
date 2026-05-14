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
    └── 20260513000001_admin_permissions_and_soft_delete/
        └── migration.sql         # AdminUser 新增 permissions + deletedAt
```

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
