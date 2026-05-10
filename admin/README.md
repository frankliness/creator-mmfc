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
| 管理员 | `/system/admins` | 管理员 CRUD |

## 1.5.2 补丁说明

- 凭据池页面补充 Base URL 格式提示，明确区分 OpenAI Compatible、Azure OpenAI、Google Gemini 与 Custom
- 模型注册表页将 `sizes` / `qualities` 的 UI 语义改为“比例 / 分辨率(质量)”，并支持在 `capabilities.pricing` 中维护动态计费
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
