# Creator MMFC — 项目技术架构文档

> 版本：v2.0 | 最后更新：2026-04-10

---

## 1. 项目概述

Creator MMFC 是一个 **AI 驱动的短剧视频批量生成平台**。用户输入剧本和角色/场景图片素材，系统通过 Google Gemini 自动拆分分镜并生成 Seedance 2.0 视频提示词，再调用 BytePlus Seedance API 批量生成视频片段，最终持久化到本地磁盘或 Google Cloud Storage。

系统由两个独立应用组成：

| 应用 | 用途 | 技术栈 | 端口 |
|------|------|--------|------|
| **用户端** (`web/`) | 面向创作者，创建项目、生成分镜、提交视频生成 | Next.js 15 + React + NextAuth v5 | 3000 |
| **管理端** (`admin/`) | 面向运营，管理用户/任务/配置/Token统计 | Fastify + Vue 3 + Ant Design Vue | 3100 / 8080 |

两个应用 **共享同一个 PostgreSQL 数据库（seedance）**，通过 Prisma ORM 访问。

---

## 2. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              客户端                                     │
│  浏览器 ──→ Next.js App (:3000)         浏览器 ──→ Vue Admin UI (:8080) │
└────────────────┬─────────────────────────────────────────┬──────────────┘
                 │                                         │
                 ▼                                         ▼
┌────────────────────────────┐             ┌──────────────────────────────┐
│     用户端 (web/)           │             │     管理端 (admin/)           │
│  ┌──────────────────────┐  │             │  ┌────────────────────────┐  │
│  │ Next.js API Routes   │  │             │  │ Fastify REST API       │  │
│  │ /api/projects/...    │  │             │  │ /api/admin/...         │  │
│  │ /api/storyboards/... │  │             │  │ 11 个功能模块           │  │
│  └──────┬───────────────┘  │             │  └────────┬───────────────┘  │
│         │                  │             │           │                  │
│  ┌──────▼───────────────┐  │             └───────────┼──────────────────┘
│  │ Worker 轮询进程       │  │                         │
│  │ 15s 间隔轮询任务状态   │  │                         │
│  └──────┬───────────────┘  │                         │
└─────────┼──────────────────┘                         │
          │                                            │
          ▼                                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL 16 (seedance)                         │
│  User | Project | Storyboard | GenerationTask | UserApiConfig        │
│  GlobalConfig | TokenUsageLog | PromptTemplate | PromptVersion       │
│  AdminUser | AuditLog                                                │
└──────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌───────────────────────┐   ┌───────────────────────┐
│ Google Gemini API      │   │ BytePlus Seedance API  │
│ 分镜 + 提示词生成       │   │ 视频生成 + 状态查询     │
└───────────────────────┘   └───────────┬───────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │ 视频持久化              │
                            │ 本地磁盘 + GCS (可选)   │
                            └───────────────────────┘
```

---

## 3. 技术选型汇总

| 层级 | 用户端 | 管理端 |
|------|--------|--------|
| 前端框架 | Next.js 15 (App Router) + React 19 | Vue 3 + Ant Design Vue 4 |
| 后端框架 | Next.js API Routes (内置) | Fastify 5 |
| ORM | Prisma 6 | Prisma 6 |
| 数据库 | PostgreSQL 16 | PostgreSQL 16 (共享) |
| 认证 | NextAuth v5 (JWT + Credentials) | 自建 JWT (accessToken + refreshToken) |
| 构建工具 | Next.js 内置 + Turbopack | Vite 6 |
| 图表 | — | ECharts 5 |
| 加密 | AES-256-GCM (Node.js crypto) | AES-256-GCM (Node.js crypto) |
| 容器化 | Docker + docker-compose | Docker + docker-compose |

---

## 4. 目录结构

### 4.1 用户端 (`web/`)

```
web/
├── prisma/
│   └── schema.prisma           # 数据库模型定义
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # REST API 路由
│   │   │   ├── auth/           # NextAuth 认证端点
│   │   │   ├── projects/       # 项目 CRUD + 分镜生成 + 批量提交
│   │   │   ├── storyboards/    # 分镜编辑 + 单个提交 + 克隆
│   │   │   └── videos/         # 视频流式播放
│   │   ├── (pages)/            # 前端页面
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── auth.ts             # NextAuth 配置（含用户状态校验）
│   │   ├── prisma.ts           # PrismaClient 单例
│   │   ├── gemini.ts           # Gemini API 调用（含 usageMetadata 提取）
│   │   ├── seedance.ts         # Seedance API 调用（支持用户级 API 配置）
│   │   ├── crypto.ts           # AES-256-GCM 加解密
│   │   ├── token-logger.ts     # 统一 Token 消耗记录工具
│   │   ├── global-config.ts    # 全局配置读取（1min 缓存）
│   │   ├── prompt-loader.ts    # Prompt 动态加载（5min TTL 缓存）
│   │   └── prompts/
│   │       ├── director-system.ts     # 导演系统提示词（679行，fallback）
│   │       └── storyboard-schema.ts   # JSON Schema（fallback）
│   └── worker/
│       ├── index.ts            # Worker 轮询主循环
│       └── video-persist.ts    # 视频下载 + GCS 上传
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### 4.2 管理端 (`admin/`)

```
admin/
├── prisma/
│   ├── schema.prisma           # 完整版 Schema（Single Source of Truth）
│   └── seed.ts                 # 初始化管理员 + Prompt 模板 + GlobalConfig
├── server/                     # Fastify API 服务
│   └── src/
│       ├── app.ts              # Fastify 应用注册
│       ├── index.ts            # 服务入口
│       ├── common/
│       │   ├── prisma.ts       # PrismaClient 单例
│       │   ├── crypto.ts       # AES-256-GCM 加解密
│       │   ├── audit.ts        # 审计日志工具
│       │   ├── pagination.ts   # 分页工具
│       │   └── guards/rbac.ts  # RBAC 权限守卫
│       └── modules/            # 11 个功能模块
│           ├── auth/           # 管理员登录/刷新/修改密码
│           ├── user/           # 用户管理（列表/详情/状态/重置密码）
│           ├── project/        # 项目管理（列表/详情/删除）
│           ├── task/           # 任务管理（列表/详情/重试/实时统计）
│           ├── api-config/     # 用户 API 配置 CRUD + 连通性测试
│           ├── global-config/  # 全局默认配置管理
│           ├── prompt/         # Prompt 模板 CRUD + 版本控制 + 回滚
│           ├── token-usage/    # Token 消耗统计 + 导出 CSV
│           ├── dashboard/      # 仪表盘聚合数据
│           ├── audit-log/      # 审计日志查询
│           └── admin-mgmt/     # 管理员 CRUD（仅 SUPER_ADMIN）
├── web/                        # Vue 3 前端
│   └── src/
│       ├── api/                # Axios 请求封装
│       ├── layouts/            # 侧边栏布局
│       ├── router/             # 路由 + 认证守卫
│       ├── store/              # Pinia 状态管理
│       └── views/              # 12 个页面视图
├── scripts/
│   ├── sync-schema.sh          # 同步 Schema 到用户端
│   ├── migrate-token-data.sql  # 历史 Token 数据迁移
│   └── seed-prompts.ts         # 从代码库导入 Prompt 到 DB（Docker 中由环境变量指向镜像内 /app/seed-web）
├── docker-compose.yml          # admin-api：build.context 为仓库根目录的父目录 ..，dockerfile: admin/server/Dockerfile
└── README.md
```

---

## 5. 数据库设计

### 5.1 ER 关系图

```
AdminUser ──1:N──→ AuditLog

User ──1:N──→ Project
User ──1:N──→ UserApiConfig
User ──1:N──→ TokenUsageLog

Project ──1:N──→ Storyboard (onDelete: Cascade)
Storyboard ──1:N──→ GenerationTask (onDelete: Cascade)

UserApiConfig ──1:N──→ GenerationTask (apiConfigId)

PromptTemplate ──1:N──→ PromptVersion

GlobalConfig（独立表，无外键）
```

### 5.2 数据表详细说明

#### User — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| email | String (unique) | 登录邮箱 |
| passwordHash | String | bcrypt 哈希密码 |
| name | String | 显示名称 |
| status | Enum(ACTIVE/SUSPENDED/DISABLED) | 用户状态，非 ACTIVE 禁止登录 |
| quota | Json? | 配额配置，如 `{"daily_video_limit": 100}` |
| remark | Text? | 管理员备注 |
| createdAt | DateTime | 注册时间 |

#### Project — 项目表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID (FK→User) | 所属用户 |
| name | String | 项目名称 |
| script | Text | 当前剧集剧本 |
| fullScript | Text | 完整剧本（供 AI 理解全局世界观） |
| assetsJson | Json | 素材列表 `[{name, uri}]` |
| assetDescriptions | Json | 人物/场景文字描述 |
| style | String | 美术/视觉风格 |
| ratio | String | 画面比例，默认 `9:16` |
| resolution | String | 分辨率，默认 `720p` |
| seedanceEndpoint | String | 创建时使用的 Seedance endpoint 快照 |
| globalSeed | Int | 全局随机种子 |
| creationMode | Enum(AUTO/MANUAL) | AUTO=AI 生成分镜, MANUAL=手动编辑 |
| status | Enum | 项目生命周期状态 |

**ProjectStatus 状态流转：**
```
DRAFT → GENERATING_STORYBOARDS → REVIEW → GENERATING_VIDEOS → COMPLETED
                  ↓                                              ↑
                FAILED ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←← FAILED
```

#### Storyboard — 分镜表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| projectId | UUID (FK→Project) | 所属项目（级联删除） |
| storyboardId | String | 分镜编号 (如 `SB-001`) |
| sortOrder | Int | 排列顺序 |
| duration | Int | 时长（10-15 秒） |
| prompt | Text | Seedance 视频提示词 |
| assetBindings | Json | 素材绑定 `[{index_label, asset_name, asset_uri}]` |
| seedanceContentItems | Json | Seedance content 数组中的 reference_image 对象 |
| status | Enum | 分镜状态 |

**StoryboardStatus 状态流转：**
```
DRAFT → APPROVED → SUBMITTED → GENERATING → SUCCEEDED
                       ↓                        ↓
                     FAILED ←←←←←←←←←←←←←← FAILED
```

#### GenerationTask — 视频生成任务表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| storyboardId | UUID (FK→Storyboard) | 所属分镜（级联删除） |
| arkTaskId | String (unique) | BytePlus Ark API 任务 ID |
| model | String | 使用的 Seedance 模型标识 |
| status | Enum | 任务状态 |
| arkStatus | String? | Ark API 返回的原始状态字符串 |
| videoUrl | Text? | Ark 返回的视频 CDN URL（临时） |
| localVideoPath | String? | 本地持久化路径 |
| gcsVideoPath | String? | GCS 持久化路径 |
| seed | BigInt? | 随机种子 |
| resolution | String? | 实际生成分辨率 |
| ratio | String? | 实际生成比例 |
| duration | Int? | 实际生成时长 |
| completionTokens | BigInt? | Seedance 完成 Token 数 |
| totalTokens | BigInt? | Seedance 总 Token 数 |
| error | Text? | 错误信息 |
| apiConfigId | UUID? (FK→UserApiConfig) | 使用的 API 配置 ID |

**TaskStatus 状态流转：**
```
SUBMITTED → RUNNING → SUCCEEDED → PERSISTING → PERSISTED
                ↓          ↓
              FAILED    FAILED (持久化失败回退到 SUCCEEDED)
```

#### UserApiConfig — 用户 API 配置表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID (FK→User) | 所属用户 |
| provider | String | 服务商标识：seedance / gemini / openai / claude |
| name | String | 配置名称（如"生产环境"） |
| endpoint | String | API 端点地址 |
| apiKey | String | **AES-256-GCM 加密存储** |
| model | String? | 指定模型 |
| isDefault | Boolean | 是否为该 Provider 默认配置 |
| isActive | Boolean | 是否启用 |

**API 配置优先级：** `UserApiConfig(isDefault=true)` → `GlobalConfig 表` → `环境变量`

#### GlobalConfig — 全局配置表

| 字段 | 类型 | 说明 |
|------|------|------|
| key | String (unique) | 配置键，如 `seedance_api_key` |
| value | Text | 配置值（敏感值 AES-256-GCM 加密） |
| encrypted | Boolean | 是否已加密 |
| remark | String? | 备注说明 |

预置配置项：`seedance_api_key`、`seedance_endpoint`、`seedance_model`、`gemini_api_key`、`gemini_model`

#### TokenUsageLog — Token 消耗日志表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID (FK→User) | 消耗用户 |
| projectId | UUID? | 关联项目 |
| taskId | UUID? | 关联任务 |
| provider | String | 服务商：seedance / gemini |
| model | String | 模型标识 |
| requestType | String | 请求类型：storyboard_generation / video_generation |
| inputTokens | BigInt | 输入 Token 数 |
| outputTokens | BigInt | 输出 Token 数 |
| totalTokens | BigInt | 总 Token 数 |
| costEstimate | Decimal(10,6)? | 预估费用 |
| metadata | Json? | 扩展元数据（如 Gemini 的 thoughtsTokenCount） |
| createdAt | DateTime | 记录时间 |

**索引设计：** `(userId)` / `(userId, provider)` / `(createdAt)` / `(userId, createdAt)` — 用于多维度统计查询。

#### PromptTemplate — 提示词模板表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | String | 显示名称 |
| slug | String (unique) | 标识符，用户端通过 slug 加载 |
| category | Enum(SYSTEM_PROMPT / JSON_SCHEMA / USER_PROMPT) | 类型分类 |
| content | Text | 当前生效内容 |
| version | Int | 当前版本号 |
| isActive | Boolean | 是否已发布 |

当前系统中的 3 个 Prompt 模板：

| slug | category | 用途 |
|------|----------|------|
| `director_system` | SYSTEM_PROMPT | Gemini 系统提示词（679 行导演指令） |
| `storyboard_schema` | JSON_SCHEMA | Gemini 结构化输出的 responseSchema |
| `user_prompt_template` | USER_PROMPT | 拼装发给 Gemini 的用户侧提示词 |

#### PromptVersion — 提示词版本历史表

每次修改 PromptTemplate 时自动创建 PromptVersion 快照，支持回滚。`(templateId, version)` 构成唯一约束。

#### AdminUser — 管理员表

独立于 User 表，使用独立的 JWT 认证体系。

| 角色 | 权限范围 |
|------|---------|
| SUPER_ADMIN | 全部权限 + 管理员 CRUD + 全局配置修改 |
| ADMIN | 用户管理 + 任务管理 + Prompt 管理 + API 配置 |
| OPERATOR | 只读所有模块 + 数据导出 |

#### AuditLog — 审计日志表

记录管理员的所有写操作（创建/修改/删除），包含变更前后的 JSON 快照。只读不可删除。

---

## 6. 核心数据流

### 6.1 分镜生成流程

```
用户创建项目（剧本 + 素材 + 风格）
        │
        ▼
POST /api/projects/:id/generate-storyboards
        │
        ├── 1. 更新 Project.status → GENERATING_STORYBOARDS
        │
        ├── 2. prompt-loader.ts 从 DB 加载 Prompt（5min TTL 缓存，fallback 到代码硬编码）
        │      ├── getPrompt("director_system", fallback)
        │      └── getJsonSchemaPrompt("storyboard_schema", fallback)
        │
        ├── 3. global-config.ts 读取 Gemini API Key（1min 缓存）
        │      └── GlobalConfig → 环境变量 fallback
        │
        ├── 4. gemini.ts → Google Gemini API
        │      ├── systemInstruction: 导演系统提示词
        │      ├── contents: 用户提示词（剧本+素材+风格拼装）
        │      ├── generationConfig: JSON mode + responseSchema
        │      └── 返回: { storyboards[], usageMetadata }
        │
        ├── 5. token-logger.ts → TokenUsageLog 表
        │      └── 记录 promptTokenCount / candidatesTokenCount / totalTokenCount
        │
        ├── 6. 清除旧分镜 → 批量写入新 Storyboard 记录
        │
        └── 7. 更新 Project.status → REVIEW
```

### 6.2 视频生成流程

```
用户批量提交分镜
        │
        ▼
POST /api/projects/:id/submit-batch
        │
        ├── 1. 查找用户的 UserApiConfig (provider=seedance, isDefault=true)
        │      └── 解密 API Key → 构造 ApiConfig 对象
        │
        ├── 2. 逐个分镜调用 seedance.ts → BytePlus Ark API
        │      ├── createSeedanceTask(input, config?)
        │      ├── 配置优先级: UserApiConfig → GlobalConfig → 环境变量
        │      └── 创建 GenerationTask 记录（含 apiConfigId）
        │
        └── 3. 更新 Project.status → GENERATING_VIDEOS
```

### 6.3 Worker 轮询流程

```
Worker 进程（15s 间隔轮询）
        │
        ▼
    pollTasks()
        │
        ├── 1. 查询 status=SUBMITTED/RUNNING 的任务（BATCH_SIZE=20）
        │      └── include: apiConfig + storyboard.project（获取 userId）
        │
        ├── 2. 每个任务：根据 apiConfigId 解密用户 API Key
        │      └── crypto.ts → decrypt(task.apiConfig.apiKey)
        │
        ├── 3. getTaskStatus(arkTaskId, apiKey)
        │
        ├── 4a. succeeded → 更新 GenerationTask + Storyboard 状态
        │       ├── 记录 completionTokens / totalTokens
        │       ├── logTokenUsage() → TokenUsageLog
        │       └── persistVideo() → 下载视频 → 上传 GCS
        │
        ├── 4b. failed → 更新 GenerationTask + Storyboard 状态
        │
        └── 4c. running → 更新 status 为 RUNNING
        
    retryPersist()
        └── 重试 videoUrl 非空但 localVideoPath 为空的任务
        
    checkProjectCompletion()
        └── 所有分镜完成 → 更新 Project.status → COMPLETED/FAILED
```

### 6.4 视频持久化流程

```
persistVideo(taskId, arkTaskId, videoUrl)
        │
        ├── 1. 更新 status → PERSISTING
        ├── 2. downloadVideo(videoUrl, arkTaskId) → /data/videos/{arkTaskId}.mp4
        ├── 3. (可选) uploadToGCS(localPath, arkTaskId) → gs://{bucket}/videos/{arkTaskId}.mp4
        └── 4. 更新 status → PERSISTED，记录 localVideoPath + gcsVideoPath
```

### 6.5 API 配置查找流程

```
用户发起任务时 API 配置的查找优先级：

    ┌─────────────────────────────────────┐
    │ 1. UserApiConfig                     │
    │    (userId, provider, isDefault=true) │
    │    → AES-256-GCM 解密 apiKey         │
    └───────────────┬─────────────────────┘
                    │ 未找到
                    ▼
    ┌─────────────────────────────────────┐
    │ 2. GlobalConfig 表                   │
    │    key = "seedance_api_key" 等        │
    │    → 1min 内存缓存 + 解密             │
    └───────────────┬─────────────────────┘
                    │ 未找到
                    ▼
    ┌─────────────────────────────────────┐
    │ 3. 环境变量 fallback                  │
    │    process.env.SEEDANCE_API_KEY 等    │
    └─────────────────────────────────────┘
```

### 6.6 Prompt 动态加载流程

```
gemini.ts 调用 generateStoryboards()
        │
        ├── getPrompt("director_system", DIRECTOR_SYSTEM_PROMPT)
        │      │
        │      ├── 检查内存缓存（5min TTL）
        │      │      └── 命中 → 返回缓存内容
        │      │
        │      └── 未命中 → prisma.promptTemplate.findFirst(slug, isActive)
        │             └── DB 有值 → 更新缓存并返回
        │             └── DB 无值 → 使用代码中的 fallback 常量
        │
        └── getJsonSchemaPrompt("storyboard_schema", STORYBOARD_RESPONSE_SCHEMA)
               └── 同上 → 返回后 JSON.parse() 使用
```

---

## 7. 管理端 API 接口清单

### 7.1 认证

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /api/admin/auth/login | 登录 | 公开 |
| POST | /api/admin/auth/refresh | 刷新 Token | 公开 |
| GET | /api/admin/auth/profile | 当前管理员信息 | OPERATOR+ |
| PATCH | /api/admin/auth/password | 修改密码 | OPERATOR+ |

### 7.2 业务接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /api/admin/dashboard/overview | 核心指标 | OPERATOR+ |
| GET | /api/admin/dashboard/trends | Token 趋势 | OPERATOR+ |
| GET | /api/admin/dashboard/task-stats | 任务状态分布 | OPERATOR+ |
| GET | /api/admin/users | 用户列表 | OPERATOR+ |
| GET | /api/admin/users/:id | 用户详情 | OPERATOR+ |
| PATCH | /api/admin/users/:id | 修改用户状态/配额 | ADMIN+ |
| POST | /api/admin/users/:id/reset-password | 重置密码 | ADMIN+ |
| GET | /api/admin/users/:userId/api-configs | API 配置列表 | ADMIN+ |
| POST | /api/admin/users/:userId/api-configs | 新增 API 配置 | ADMIN+ |
| PATCH | /api/admin/users/:userId/api-configs/:id | 修改 API 配置 | ADMIN+ |
| DELETE | /api/admin/users/:userId/api-configs/:id | 删除 API 配置 | ADMIN+ |
| POST | /api/admin/users/:userId/api-configs/:id/test | 连通性测试 | ADMIN+ |
| GET | /api/admin/projects | 项目列表 | OPERATOR+ |
| GET | /api/admin/projects/:id | 项目详情 | OPERATOR+ |
| DELETE | /api/admin/projects/:id | 删除项目（级联） | ADMIN+ |
| GET | /api/admin/tasks | 任务列表 | OPERATOR+ |
| GET | /api/admin/tasks/:id | 任务详情 | OPERATOR+ |
| POST | /api/admin/tasks/:id/retry | 重试失败任务 | OPERATOR+ |
| GET | /api/admin/tasks/realtime-stats | 实时统计 | OPERATOR+ |
| GET | /api/admin/prompts | Prompt 列表 | OPERATOR+ |
| GET | /api/admin/prompts/:id | Prompt 详情+版本 | OPERATOR+ |
| POST | /api/admin/prompts | 新建 Prompt | ADMIN+ |
| PATCH | /api/admin/prompts/:id | 修改 Prompt（自动版本递增） | ADMIN+ |
| POST | /api/admin/prompts/:id/publish | 发布 | ADMIN+ |
| POST | /api/admin/prompts/:id/rollback/:ver | 版本回滚 | ADMIN+ |
| GET | /api/admin/prompts/:id/versions | 版本历史 | OPERATOR+ |
| GET | /api/admin/token-usage/summary | 按时间维度统计 | OPERATOR+ |
| GET | /api/admin/token-usage/by-user | 用户排名 | OPERATOR+ |
| GET | /api/admin/token-usage/by-provider | Provider 分布 | OPERATOR+ |
| GET | /api/admin/token-usage/detail | 明细列表 | OPERATOR+ |
| GET | /api/admin/token-usage/export | CSV 导出 | OPERATOR+ |
| GET | /api/admin/global-configs | 全局配置列表 | ADMIN+ |
| PATCH | /api/admin/global-configs/:key | 修改全局配置 | SUPER_ADMIN |
| GET | /api/admin/audit-logs | 审计日志列表 | OPERATOR+ |
| GET | /api/admin/admins | 管理员列表 | SUPER_ADMIN |
| POST | /api/admin/admins | 新增管理员 | SUPER_ADMIN |
| PATCH | /api/admin/admins/:id | 修改管理员 | SUPER_ADMIN |

---

## 8. 安全设计

### 8.1 认证与授权

- **用户端**：NextAuth v5，Credentials Provider，JWT Session，bcrypt 密码哈希
- **管理端**：自建 JWT，accessToken 2h + refreshToken 7d，bcrypt rounds 12
- **RBAC 三级角色**：通过 Fastify preHandler hook 实现，按角色层级数值比较

### 8.2 数据加密

- **API Key 存储**：AES-256-GCM 加密，格式 `iv:authTag:ciphertext`
- **加密密钥**：通过 `ENCRYPTION_KEY` 环境变量注入（≥32 字符）
- **管理端展示**：API Key 仅返回尾 4 位，其余 mask 为 `*`

### 8.3 审计追踪

- 管理端所有写操作自动记录 AuditLog
- 包含：操作者 ID、操作类型、目标类型/ID、变更前后 JSON 快照、IP 地址
- 审计日志只读不可删除

---

## 9. Prisma Schema 共享策略

```
Admin 仓库 (schema.prisma 完整版)
    │
    ├── prisma db push / migrate deploy → PostgreSQL
    │
    └── scripts/sync-schema.sh → User 仓库 (schema.prisma)
                                      │
                                      └── prisma generate（仅生成客户端，不执行 migrate）
```

- Admin 仓库为 **Schema 唯一权威（Single Source of Truth）**
- Admin 仓库负责所有数据库变更
- 用户端仓库只运行 `prisma generate`，不执行 `migrate`
