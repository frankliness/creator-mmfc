# Creator MMFC 管理后台

独立的后台管理系统，用于管理 creator_mmfc 用户端的所有业务数据。

## 架构

- **后端**: Node.js + Fastify + Prisma 6 + TypeScript
- **前端**: Vue 3 + Ant Design Vue + ECharts + Vite
- **数据库**: PostgreSQL 16 (与用户端共享)

## 快速启动

### 1. 后端

```bash
cd server
cp .env.example .env  # 修改配置
npm install
npx --no-install prisma generate --schema ../prisma/schema.prisma
npx --no-install prisma db push --schema ../prisma/schema.prisma
npx tsx ../prisma/seed.ts
npm run dev
```

默认管理员: `admin` / `admin123456`

### 2. 前端

```bash
cd web
npm install
npm run dev
```

访问 http://localhost:8080

### 3. Docker 部署

```bash
cp .env.example .env  # 配置环境变量
docker-compose up -d
```

## 功能模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 核心指标、趋势图表 |
| 用户管理 | `/users` | 列表、详情、状态、API 配置 |
| 项目管理 | `/projects` | 列表、详情、分镜预览 |
| 任务管理 | `/tasks` | 列表、详情、视频预览、重试 |
| Prompt 管理 | `/prompts` | 文本/JSON Schema 编辑、版本控制 |
| 凭据池 | `/system/credentials` | ProviderCredential CRUD、连通性测试、主用切换 |
| 默认模型 | `/system/defaults` | 按用途配置默认模型 |
| 模型注册表 | `/system/model-registry` | 管理模型能力、比例、分辨率/质量、pricing |
| Token 统计 | `/token-usage` | 日/周/月维度、用户排名、导出 |
| 审计日志 | `/audit-logs` | 管理员操作记录 |
| 全局配置 | `/system/global-config` | 默认指针与兼容兜底项 |
| 管理员 | `/system/admins` | 管理员 CRUD + 权限矩阵管理 |
| 用户行为日志 | `/user-action-logs` | 用户在平台上的交互记录 |
| 画布渠道统计 | `/canvas-channel-stats` | 画布生图各渠道成功 / 失败 / 限流统计 |

## v1.8.0 权限管理系统

管理后台引入了细粒度权限矩阵，支持按分栏与操作类型（read/write）进行精细控制：

### 权限体系

- **SUPER_ADMIN**：全部权限，不受矩阵限制，不可删除（系统必须保留至少一个）
- **ADMIN**：支持配置权限矩阵，可访问的分栏和操作受矩阵控制
- **OPERATOR**：受限账号，权限矩阵中 write 权限受限

### 14 个权限分栏

| 分栏 | 描述 | 标准权限 |
|------|------|------|
| dashboard | 仪表盘 | read |
| users | 用户管理 | read, write |
| projects | 项目管理 | read, write |
| canvasProjects | AI 画布项目 | read, write |
| canvasChannelStats | 画布渠道统计 | read |
| tasks | 任务管理 | read, write |
| prompts | Prompt 管理 | read, write |
| tokenUsage | Token 统计 | read |
| userActionLogs | 用户行为日志 | read |
| auditLogs | 审计日志 | read |
| credentials | 凭据池 | read, write |
| globalConfig | 全局配置 | read, write |
| modelRegistry | 模型注册表 | read, write |
| defaults | 默认模型配置 | read, write |

### 管理员管理（/system/admins）

- **列表展示**：用户名、显示名、角色、状态、权限摘要、最后登录、创建时间
- **权限摘要**：SUPER_ADMIN 显示”全部权限”；其他角色显示可读 / 可写分栏数
- **新建 / 编辑**：可配置权限矩阵，选择读写权限
- **禁用 / 删除**：
  - 禁用：账号标记为已禁用，旧 token 立即失效
  - 软删除：账号标记为已删除，列表默认隐藏，无法再次登录
- **重置密码**：为用户设置新密码，需要 `users.write` 权限

### 前端权限控制

- **菜单过滤**：根据 `read` 权限动态显示菜单，无任何权限时显示”无权限访问”提示
- **路由守卫**：访问无权限路由自动跳转 `/403`
- **按钮 gating**：写操作按钮受 `write` 权限控制，无权时隐藏或禁用

### 后端权限校验

- 每个请求通过 `requirePermission(section, action)` 或 `requireSuperAdmin()` 守卫进行权限检查
- 查询 DB 校验 admin 状态（`isActive` 与 `deletedAt`），禁用 / 软删用户的旧 token **立即失效**（不依赖 JWT 过期）
- 未授权返回 `403 Forbidden`，无账号信息返回 `401 Unauthorized`

### 自我保护机制

- 禁止修改自己的角色（role）
- 禁止禁用 / 删除自己的账号
- 系统必须保留至少一个启用的 SUPER_ADMIN

### 迁移步骤（从旧版升级）

```bash
# 1. 应用数据库迁移
cd admin
npx prisma migrate deploy

# 2. 回填现有 ADMIN / OPERATOR 的默认权限
npm run db:backfill-permissions

# 3. 重启服务
docker compose up -d --build
```

迁移后，旧的 ADMIN 和 OPERATOR 账号会自动获得对应的默认权限矩阵；SUPER_ADMIN 保持全权。

---

## 1.5.2 补丁说明

- 凭据池页面补充 Base URL 格式提示，明确区分 OpenAI Compatible、Azure OpenAI、Google Gemini 与 Custom
- 模型注册表页将 `sizes` / `qualities` 的 UI 语义改为”比例 / 分辨率(质量)”，并支持在 `capabilities.pricing` 中维护动态计费
- 管理端共享 Prisma schema 同步新增 `Storyboard.seed` 与 `CanvasAiCall.costEstimate`

## 用户端改造

用户端 (creator_mmfc/web) 的改动：

- `prisma/schema.prisma` - 新增 UserApiConfig/TokenUsageLog/PromptTemplate 等模型
- `src/lib/auth.ts` - 新增用户状态校验
- `src/lib/seedance.ts` - 支持用户级 API 配置参数
- `src/lib/gemini.ts` - 提取 usageMetadata + 动态 Prompt 加载
- `src/worker/index.ts` - 按 apiConfigId 解密 Key + Token 日志
- `src/lib/token-logger.ts` - 统一 Token 记录工具
- `src/lib/prompt-loader.ts` - Prompt 动态加载 (5min TTL)
- `src/lib/global-config.ts` - 全局配置读取
- `src/lib/crypto.ts` - AES-256-GCM 加解密
- `docker-compose.yml` - Worker 新增 ENCRYPTION_KEY 环境变量
