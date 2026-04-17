# Creator MMFC — 运维部署技术文档

> 版本：v2.0 | 最后更新：2026-04-10

本文档提供从零开始搭建 Creator MMFC 全套服务（用户端 + 管理端）的完整步骤。

---

## 目录

1. [环境要求](#1-环境要求)
2. [前置准备](#2-前置准备)
3. [数据库部署](#3-数据库部署)
4. [用户端部署](#4-用户端部署)
5. [管理端部署](#5-管理端部署)
6. [Docker 一键部署](#6-docker-一键部署)
7. [Nginx 反向代理配置](#7-nginx-反向代理配置)
8. [环境变量完整参考](#8-环境变量完整参考)
9. [数据库迁移与同步](#9-数据库迁移与同步)
10. [Seed 初始化数据](#10-seed-初始化数据)
11. [日常运维操作](#11-日常运维操作)
12. [监控与告警](#12-监控与告警)
13. [备份与恢复](#13-备份与恢复)
14. [故障排查手册](#14-故障排查手册)
15. [安全加固清单](#15-安全加固清单)

---

## 1. 环境要求

### 1.1 服务器最低配置

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 40 GB SSD | 100 GB SSD（视频存储） |
| 操作系统 | Ubuntu 22.04+ / macOS 13+ | Ubuntu 24.04 LTS |

### 1.2 软件依赖

| 软件 | 版本要求 | 用途 |
|------|---------|------|
| Node.js | ≥ 20.x | 运行时 |
| npm | ≥ 10.x | 包管理 |
| PostgreSQL | ≥ 16.x | 数据库 |
| Docker | ≥ 24.x | 容器化部署（可选） |
| Docker Compose | ≥ 2.20 | 多容器编排（可选） |
| Git | ≥ 2.x | 代码拉取 |

### 1.3 外部服务账号

| 服务 | 用途 | 获取方式 |
|------|------|---------|
| Google Gemini API Key | AI 分镜生成 | https://aistudio.google.com/apikey |
| BytePlus Seedance API Key | 视频生成 | BytePlus 控制台申请 |
| Google Cloud 服务账号 JSON | GCS 视频持久化（可选） | GCP Console → IAM → Service Account |

---

## 2. 前置准备

### 2.1 生成安全密钥

在开始部署前，先生成以下密钥（**生产环境必须替换默认值**）：

```bash
# NextAuth Secret（用户端 JWT 密钥）
openssl rand -base64 32
# 输出示例: dK3jF8xL2mN9pQ5r...

# Admin JWT Secret（管理端 JWT 密钥）
openssl rand -base64 32
# 输出示例: hT7wZ1cB4vX6yA0e...

# Encryption Key（AES-256-GCM 加密密钥，≥32 字符）
openssl rand -hex 16
# 输出示例: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6

# 数据库密码
openssl rand -base64 16
# 输出示例: pGx8Rj2Kf1Lm4Np7
```

**重要：** 以上密钥请妥善保存，`ENCRYPTION_KEY` 一旦确定后不可更改（否则已加密的 API Key 将无法解密）。

### 2.2 克隆代码

```bash
git clone <repository-url> creator_mmfc
cd creator_mmfc
```

---

## 3. 数据库部署

### 3.1 方式一：Docker 部署 PostgreSQL

```bash
docker run -d \
  --name creator-mmfc-postgres \
  -p 5432:5432 \
  -e POSTGRES_DB=seedance \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=<你的数据库密码> \
  -v pgdata:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine
```

### 3.2 方式二：系统安装 PostgreSQL

```bash
# Ubuntu
sudo apt update && sudo apt install -y postgresql-16

# macOS (Homebrew)
brew install postgresql@16
brew services start postgresql@16
```

创建数据库：

```bash
sudo -u postgres psql -c "CREATE DATABASE seedance;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '<你的数据库密码>';"
```

### 3.3 验证数据库连接

```bash
psql postgresql://postgres:<密码>@localhost:5432/seedance -c "SELECT 1;"
```

---

## 4. 用户端部署

### 4.1 安装依赖

```bash
cd web
cp .env.example .env
npm install
```

### 4.2 配置环境变量

编辑 `web/.env`：

```bash
# 数据库
DATABASE_URL="postgresql://postgres:<密码>@localhost:5432/seedance"

# NextAuth
NEXTAUTH_SECRET="<步骤2.1生成的值>"
NEXTAUTH_URL="http://localhost:3000"    # 生产环境改为实际域名

# Gemini
GEMINI_API_KEY="<你的 Gemini API Key>"
GEMINI_MODEL="gemini-3.1-pro-preview"

# Seedance
SEEDANCE_API_KEY="<你的 Seedance API Key>"
SEEDANCE_ENDPOINT="ep-20260328102217-9cg74"
SEEDANCE_MODEL="dreamina-seedance-2-0-260128"

# GCS（可选，不配置则仅本地存储）
GCS_BUCKET="your-bucket-name"
GCS_PROJECT_ID="your-project-id"
GOOGLE_APPLICATION_CREDENTIALS="./your-service-account.json"

# 视频存储
VIDEO_STORAGE_PATH="./data/videos"

# Worker
WORKER_POLL_INTERVAL="15000"

# 加密密钥（用于解密 UserApiConfig 中的 API Key）
ENCRYPTION_KEY="<步骤2.1生成的值>"
```

### 4.3 初始化数据库

```bash
# 同步数据库结构
npx prisma db push

# 生成 Prisma Client
npx prisma generate
```

### 4.4 构建并启动

**开发模式：**

```bash
npm run dev
```

**生产模式：**

```bash
npm run build
npm run start
```

### 4.5 启动 Worker

Worker 是一个独立的 Node.js 进程，负责轮询视频生成任务状态。**必须同时运行：**

```bash
# 开发模式
npx tsx src/worker/index.ts

# 生产模式（使用 pm2 或 systemd）
npx tsx src/worker/index.ts
```

### 4.6 创建视频存储目录

```bash
mkdir -p data/videos
```

### 4.7 验证用户端

```bash
# 健康检查
curl http://localhost:3000

# 注册用户（通过界面或 API）
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456","name":"测试用户"}'
```

---

## 5. 管理端部署

### 5.1 安装依赖

```bash
cd admin/server
cp .env.example .env
npm install
```

### 5.2 配置环境变量

编辑 `admin/server/.env`：

```bash
DATABASE_URL="postgresql://postgres:<密码>@localhost:5432/seedance"
ADMIN_JWT_SECRET="<步骤2.1生成的值>"
ENCRYPTION_KEY="<步骤2.1生成的值，必须与用户端一致>"
PORT=3100
CORS_ORIGIN="http://localhost:8080"     # 生产环境改为管理端前端域名
```

**关键：** `ENCRYPTION_KEY` 必须与用户端的值完全一致，否则无法解密用户的 API Key。

### 5.3 同步数据库

管理端 Schema 是完整版（包含 AdminUser、AuditLog 等管理专用表）：

```bash
# 将管理端 Schema 推送到数据库
npx --no-install prisma db push --schema ../prisma/schema.prisma

# 生成 Prisma Client
npx --no-install prisma generate --schema ../prisma/schema.prisma
```

### 5.4 初始化数据

```bash
# 创建默认管理员 + Prompt 模板 + GlobalConfig
npx tsx ../prisma/seed.ts

# 从代码库导入实际 Prompt 内容到数据库
npx tsx ../scripts/seed-prompts.ts
```

默认管理员账号：`admin` / `admin123456`

**警告：首次登录后立即修改默认密码。**

### 5.5 启动后端 API

```bash
# 开发模式
npm run dev

# 生产模式
npm run build && npm run start
```

### 5.6 启动前端

```bash
cd ../web
npm install
npm run dev      # 开发模式，端口 8080
# 或
npm run build    # 生产构建到 dist/
```

### 5.7 验证管理端

```bash
# 健康检查
curl http://localhost:3100/api/admin/health
# 应返回: {"status":"ok"}

# 登录
curl -X POST http://localhost:3100/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}'
# 应返回 accessToken + refreshToken
```

浏览器访问 http://localhost:8080 → 登录页面。

---

## 6. Docker 一键部署

### 6.0 仓库根目录全套编排（推荐：单库 + 用户端 + Worker + 管理端）

在 **仓库根目录** 使用 `docker-compose.yml` 一次启动：PostgreSQL、`web-app`（用户端）、`web-worker`、`admin-api`、`admin-web`（Nginx 反代管理 API，浏览器只需访问 **8080**）。

```bash
cd /path/to/creator_mmfc
cp .env.docker.example .env
# 编辑 .env：DB_PASSWORD、NEXTAUTH_*、ENCRYPTION_KEY、ADMIN_JWT_SECRET、GEMINI_API_KEY、SEEDANCE_API_KEY 等

docker compose up -d --build
```

**内网访问：** 将 `NEXTAUTH_URL` 设为 `http://<服务器局域网IP>:3000`，将 `CORS_ORIGIN` 设为 `http://<服务器局域网IP>:8080`（多客户端可用英文逗号分隔多个 Origin）。宿主机防火墙需放行 `WEB_PORT`（默认 3000）与 `ADMIN_WEB_PORT`（默认 8080）。`AUTH_TRUST_HOST` 默认已设为 `true`，便于通过 IP 访问用户端。

**首次初始化：** `db-init` 容器会依次执行 `prisma db push`、`prisma/seed.ts`（默认管理员与占位 Prompt）、`scripts/seed-prompts.ts`（从镜像内打包的 `web` 源码导入真实 Prompt 到数据库）。默认管理员：`admin` / `admin123456`（登录后请立即修改密码）。

**镜像构建上下文：** `db-init` 与 `admin-api` 使用 **`admin/server/Dockerfile`，且 `build.context` 为仓库根目录**，以便将 `web/src/lib/prompts/` 与 `gemini.ts` 打入镜像供 `seed-prompts` 读取。切勿仅在 `admin/` 目录下用旧方式 `docker build -f server/Dockerfile .` 构建，否则会缺少上述文件导致 `seed-prompts` 失败。

**已部署环境补录 Prompt：** 拉取新镜像并重建后执行 `docker compose run --rm db-init`（会再次执行 push、seed、seed-prompts；`seed` 对已存在数据跳过，`seed-prompts` 在内容未变时会跳过更新）。用户端 `prompt-loader` 若发现数据库仍为 `[待从代码库导入]` 占位文案，会回退使用代码内嵌的真实 Prompt，避免错误提示词上线。

**本地视频目录：** `web-app` 与 `web-worker` 将容器内 `/data/videos` 绑定到宿主机 **`web/data/videos`**（相对仓库根目录）。首次部署建议先执行 `mkdir -p web/data/videos`。若出现容器内无法写入，可适当放宽目录权限（例如 `chmod 777 web/data/videos`，生产环境请按宿主机 UID/GID 与容器用户 `nextjs`（uid 1001）对齐调整）。

**PostgreSQL 端口：** 默认 **不** 映射到宿主机，仅 Docker 内网可连；若需本机 `psql` 连接，在根目录 `docker-compose.yml` 的 `postgres` 服务中取消 `ports: "5432:5432"` 的注释。

**与分目录 compose 的关系：** 仍可单独使用 `web/docker-compose.yml` 或 `admin/docker-compose.yml` 调试；生产建议只用根目录一套编排，避免双实例 PostgreSQL。

### 6.1 用户端 Docker 部署

```bash
cd web
cp .env.example .env
# 编辑 .env 填入所有配置...

docker-compose up -d
```

启动 3 个容器：
- `postgres` — PostgreSQL 数据库
- `app` — Next.js 应用（端口 3000）
- `worker` — Worker 轮询进程

```bash
# 查看日志
docker-compose logs -f app
docker-compose logs -f worker

# 初始化数据库（首次部署）
docker-compose exec app npx prisma db push
```

### 6.2 管理端 Docker 部署

```bash
cd admin

# 创建 .env
cat > .env << 'EOF'
ADMIN_JWT_SECRET=<生成的JWT密钥>
ENCRYPTION_KEY=<与用户端一致的加密密钥>
EOF

docker-compose up -d
```

启动 3 个容器：
- `postgres` — PostgreSQL（如果已有可共享，去掉 admin 的 postgres 服务）
- `admin-api` — Fastify API（端口 3100）
- `admin-web` — Nginx + Vue 静态文件（端口 8080）

### 6.3 共享 PostgreSQL 部署方案

生产环境中，用户端和管理端应共享同一个 PostgreSQL 实例。

**推荐架构：** 仅用户端的 docker-compose 启动 PostgreSQL，管理端连接同一实例。

修改 `admin/docker-compose.yml`（`admin-api` 构建上下文为仓库上一级目录，以便打包用户端 prompt 源文件）：

```yaml
services:
  admin-api:
    build:
      context: ..
      dockerfile: admin/server/Dockerfile
    ports:
      - "3100:3100"
    environment:
      # 连接用户端的 PostgreSQL
      DATABASE_URL: "postgresql://postgres:<密码>@<用户端主机IP>:5432/seedance"
      ADMIN_JWT_SECRET: "${ADMIN_JWT_SECRET}"
      ENCRYPTION_KEY: "${ENCRYPTION_KEY}"
      CORS_ORIGIN: "${CORS_ORIGIN:-http://localhost:8080}"
    restart: unless-stopped

  admin-web:
    build:
      context: web
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    depends_on:
      - admin-api
    restart: unless-stopped
```

---

## 7. Nginx 反向代理配置

生产环境建议通过 Nginx 统一入口，配置 SSL。

```nginx
# 用户端
server {
    listen 443 ssl;
    server_name app.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/app.crt;
    ssl_certificate_key /etc/ssl/private/app.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# 管理端前端
server {
    listen 443 ssl;
    server_name admin.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/admin.crt;
    ssl_certificate_key /etc/ssl/private/admin.key;

    # 静态资源（Vue 构建产物）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API 转发
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

部署后更新管理端环境变量：

```bash
CORS_ORIGIN="https://admin.yourdomain.com"
NEXTAUTH_URL="https://app.yourdomain.com"
```

---

## 8. 环境变量完整参考

### 8.1 用户端 (web/.env)

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是 | — | PostgreSQL 连接字符串 |
| `NEXTAUTH_SECRET` | 是 | — | NextAuth JWT 密钥，≥32 字符 |
| `NEXTAUTH_URL` | 是 | http://localhost:3000 | 用户端访问 URL |
| `GEMINI_API_KEY` | 是 | — | Google Gemini API Key |
| `GEMINI_MODEL` | 否 | gemini-3.1-pro-preview | Gemini 模型 |
| `SEEDANCE_API_KEY` | 是 | — | BytePlus Seedance API Key |
| `SEEDANCE_ENDPOINT` | 否 | ep-20260328102217-9cg74 | Seedance Endpoint ID |
| `SEEDANCE_MODEL` | 否 | dreamina-seedance-2-0-260128 | Seedance 模型 |
| `GCS_BUCKET` | 否 | — | GCS 存储桶名称 |
| `GCS_PROJECT_ID` | 否 | — | GCP 项目 ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | 否 | — | GCS 服务账号 JSON 路径 |
| `VIDEO_STORAGE_PATH` | 否 | ./data/videos | 本地视频存储路径 |
| `WORKER_POLL_INTERVAL` | 否 | 15000 | Worker 轮询间隔(ms) |
| `ENCRYPTION_KEY` | 是 | — | AES-256-GCM 加密密钥，≥32 字符 |

### 8.2 管理端 (admin/server/.env)

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是 | — | PostgreSQL 连接字符串 |
| `ADMIN_JWT_SECRET` | 是 | — | 管理端 JWT 密钥 |
| `ENCRYPTION_KEY` | 是 | — | AES 密钥，**必须与用户端一致** |
| `PORT` | 否 | 3100 | API 监听端口 |
| `CORS_ORIGIN` | 否 | http://localhost:8080 | 允许的前端域名 |

---

## 9. 数据库迁移与同步

### 9.1 Schema 变更流程

管理端 Schema 是唯一权威。变更流程：

```bash
# 1. 在管理端修改 Schema
vim admin/prisma/schema.prisma

# 2. 推送到数据库
cd admin/server
npx --no-install prisma db push --schema ../prisma/schema.prisma

# 3. 同步到用户端
bash ../scripts/sync-schema.sh ../../web

# 4. 用户端重新生成 Client
cd ../../web
npx prisma generate
```

### 9.2 历史 Token 数据迁移

首次部署管理端后，将现有 GenerationTask 中的 Token 数据迁移到 TokenUsageLog：

```bash
psql postgresql://postgres:<密码>@localhost:5432/seedance \
  -f admin/scripts/migrate-token-data.sql
```

此脚本是幂等的（NOT EXISTS 检查），可安全重复执行。

---

## 10. Seed 初始化数据

### 10.1 首次部署

**仓库根目录 `docker compose up`：** `db-init` 已自动串联 `seed.ts` 与 `seed-prompts.ts`，无需再手动执行本节命令（除非单独调试）。

本地或自建流程仍可按下列步骤执行：

```bash
cd admin/server

# Step 1: 创建默认管理员 + 占位 Prompt + GlobalConfig
npx tsx ../prisma/seed.ts

# Step 2: 从代码库导入实际 Prompt 内容
npx tsx ../scripts/seed-prompts.ts

# Step 3: (可选) 迁移历史 Token 数据
psql $DATABASE_URL -f ../scripts/migrate-token-data.sql
```

### 10.2 初始化数据清单

| 数据 | 内容 | 操作 |
|------|------|------|
| AdminUser | admin / admin123456 (SUPER_ADMIN) | seed.ts |
| PromptTemplate × 3 | director_system / storyboard_schema / user_prompt_template | seed.ts + seed-prompts.ts |
| GlobalConfig × 5 | seedance_api_key / seedance_endpoint / seedance_model / gemini_api_key / gemini_model | seed.ts |

---

## 11. 日常运维操作

### 11.1 服务管理

```bash
# 查看所有容器状态
docker-compose ps

# 重启单个服务
docker-compose restart app
docker-compose restart worker
docker-compose restart admin-api

# 查看实时日志
docker-compose logs -f worker --tail=100

# 进入容器
docker-compose exec app sh
```

### 11.2 使用 PM2 管理（非 Docker 部署）

```bash
npm install -g pm2

# 用户端
pm2 start npm --name "mmfc-app" -- start
pm2 start "npx tsx src/worker/index.ts" --name "mmfc-worker"

# 管理端
pm2 start "npx tsx src/index.ts" --name "mmfc-admin-api" --cwd admin/server

# 查看状态
pm2 status
pm2 logs mmfc-worker

# 开机自启
pm2 save
pm2 startup
```

### 11.3 管理员密码重置

```bash
# 通过 Prisma CLI 直接操作数据库
cd admin/server
npx tsx -e "
const { hash } = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const h = await hash('newpassword123', 12);
  await prisma.adminUser.update({ where: { username: 'admin' }, data: { passwordHash: h } });
  console.log('Password reset done');
  await prisma.\$disconnect();
})();
"
```

### 11.4 用户状态管理

```bash
# 禁用用户（禁止登录）
psql $DATABASE_URL -c "UPDATE \"User\" SET status = 'DISABLED' WHERE email = 'user@example.com';"

# 恢复用户
psql $DATABASE_URL -c "UPDATE \"User\" SET status = 'ACTIVE' WHERE email = 'user@example.com';"
```

### 11.5 清理过期视频文件

```bash
# 清理 30 天前的本地视频（确保已上传 GCS）
find /data/videos -name "*.mp4" -mtime +30 -exec rm -f {} \;
```

---

## 12. 监控与告警

### 12.1 健康检查端点

| 服务 | URL | 预期响应 |
|------|-----|---------|
| 用户端 | http://localhost:3000 | 200 OK (HTML) |
| 管理端 API | http://localhost:3100/api/admin/health | `{"status":"ok"}` |
| PostgreSQL | `pg_isready -h localhost -p 5432` | 退出码 0 |

### 12.2 关键指标监控

```bash
# Worker 队列积压（SUBMITTED + RUNNING 任务数）
psql $DATABASE_URL -c "
  SELECT status, COUNT(*) 
  FROM \"GenerationTask\" 
  WHERE status IN ('SUBMITTED', 'RUNNING') 
  GROUP BY status;
"

# 任务失败率（近 24 小时）
psql $DATABASE_URL -c "
  SELECT 
    COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
    COUNT(*) as total,
    ROUND(COUNT(*) FILTER (WHERE status = 'FAILED')::numeric / NULLIF(COUNT(*), 0) * 100, 2) as fail_rate
  FROM \"GenerationTask\"
  WHERE \"createdAt\" > NOW() - INTERVAL '24 hours';
"

# Token 消耗日报
psql $DATABASE_URL -c "
  SELECT provider, model, SUM(\"totalTokens\") as tokens, COUNT(*) as requests
  FROM \"TokenUsageLog\"
  WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'
  GROUP BY provider, model;
"
```

### 12.3 磁盘空间监控

```bash
# 视频存储占用
du -sh /data/videos/

# 数据库大小
psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_database_size('seedance'));"
```

---

## 13. 备份与恢复

### 13.1 数据库备份

```bash
# 完整备份
pg_dump -h localhost -U postgres -d seedance -Fc -f seedance_$(date +%Y%m%d_%H%M%S).dump

# 仅结构
pg_dump -h localhost -U postgres -d seedance --schema-only -f schema.sql

# 定时备份（crontab）
# 每天凌晨 2 点备份
0 2 * * * pg_dump -h localhost -U postgres -d seedance -Fc -f /backup/seedance_$(date +\%Y\%m\%d).dump
```

### 13.2 数据库恢复

```bash
# 恢复到新数据库
createdb seedance_restore
pg_restore -h localhost -U postgres -d seedance_restore seedance_20260410.dump

# 恢复到同名数据库（先断开所有连接）
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='seedance' AND pid <> pg_backend_pid();"
dropdb seedance
createdb seedance
pg_restore -h localhost -U postgres -d seedance seedance_20260410.dump

# 恢复后重新生成 Prisma Client
cd web && npx prisma generate
cd admin/server && npx --no-install prisma generate --schema ../prisma/schema.prisma
```

### 13.3 视频文件备份

```bash
# 同步到 GCS（如果配置了 GCS）
gsutil -m rsync -r /data/videos/ gs://your-bucket/backup/videos/

# 或同步到远程服务器
rsync -avz /data/videos/ remote-server:/backup/videos/
```

---

## 14. 故障排查手册

### 14.1 用户端无法启动

| 症状 | 可能原因 | 排查步骤 |
|------|---------|---------|
| `PrismaClientInitializationError` | 数据库未启动或连接字符串错误 | 检查 `pg_isready`，验证 `DATABASE_URL` |
| `NEXTAUTH_SECRET is not set` | 环境变量缺失 | 检查 `.env` 文件 |
| Port 3000 already in use | 端口被占用 | `lsof -i :3000` 找到并停止 |

### 14.2 Worker 不工作

| 症状 | 可能原因 | 排查步骤 |
|------|---------|---------|
| 任务一直 SUBMITTED | Worker 未启动 | 检查 Worker 进程是否运行 |
| `SEEDANCE_API_KEY 未配置` | 环境变量缺失且 GlobalConfig/UserApiConfig 均无配置 | 检查环境变量或管理端全局配置 |
| `Failed to decrypt API key` | ENCRYPTION_KEY 不一致 | 确认 Worker 和管理端使用相同的 ENCRYPTION_KEY |
| 任务循环 FAILED | Seedance API Key 无效或余额不足 | 在管理端测试 API 连通性 |

### 14.3 管理端问题

| 症状 | 可能原因 | 排查步骤 |
|------|---------|---------|
| 登录返回 401 | 密码错误或账号被禁用 | 检查 AdminUser 表 isActive 字段 |
| API 配置显示 "(未设置)" | ENCRYPTION_KEY 未配置或与加密时不一致 | 检查 admin/.env |
| CORS 错误 | CORS_ORIGIN 与前端域名不匹配 | 修改 `CORS_ORIGIN` 环境变量 |

### 14.4 视频持久化失败

| 症状 | 可能原因 | 排查步骤 |
|------|---------|---------|
| `localVideoPath` 为空 | 下载超时或磁盘满 | 检查磁盘空间 `df -h`，Worker 日志 |
| GCS 上传失败 | 服务账号权限不足 | 检查 `GOOGLE_APPLICATION_CREDENTIALS` 路径和权限 |
| 任务停在 PERSISTING | 持久化进程异常中断 | Worker 会在下次轮询时通过 `retryPersist()` 自动重试 |

### 14.5 Prompt 修改不生效

Prompt 使用 5 分钟内存缓存，修改后最多等待 5 分钟生效。如需立即生效，重启用户端 App 和 Worker。

---

## 15. 安全加固清单

### 部署前必做

- [ ] 替换所有默认密码和密钥（`admin123456`、`dev-secret-change-me`）
- [ ] 生成强随机 `NEXTAUTH_SECRET`（≥32 字符）
- [ ] 生成强随机 `ADMIN_JWT_SECRET`（≥32 字符）
- [ ] 生成强随机 `ENCRYPTION_KEY`（≥32 字符）
- [ ] 设置强数据库密码
- [ ] `.env` 文件权限设为 600：`chmod 600 .env`
- [ ] GCS 服务账号 JSON 不纳入版本控制

### 网络安全

- [ ] PostgreSQL 不暴露到公网（仅绑定 127.0.0.1 或使用 Docker 内网）
- [ ] 管理端仅允许内网或 VPN 访问
- [ ] 配置 HTTPS（Nginx + Let's Encrypt）
- [ ] 设置正确的 `CORS_ORIGIN`（不使用 `*`）

### 运行时安全

- [ ] 定期轮换 API Key（通过管理端 GlobalConfig）
- [ ] 定期审查 AuditLog 中的敏感操作
- [ ] 禁用不活跃用户（管理端用户状态管理）
- [ ] 监控任务失败率，异常时告警

### 备份

- [ ] 数据库每日自动备份
- [ ] 备份文件异地存储
- [ ] 定期验证备份可恢复性
