# Creator MMFC 架构文档

> 更新日期：2026-04-25
> 适用范围：当前仓库 `/Users/hh/Desktop/creator_mmfc`
> 文档目标：面向开发、运维、二次改造人员，说明系统边界、代码结构、运行时数据流、核心模型、部署方式与主要设计取舍。

---

## 1. 项目定位

Creator MMFC 是一个围绕“分镜生成 + 视频生成 + AI 画布创作 + 管理后台”构建的一体化系统。它不是单体页面应用，而是一个**多前端、多服务、共享数据库**的仓库。

当前仓库包含四块核心运行单元：

1. `web/`
   用户端主应用。基于 Next.js App Router，承担登录注册、项目管理、分镜编辑、视频提交与播放，以及 Canvas 相关 API。
2. `web/src/worker/`
   异步任务轮询 Worker。与用户端共用同一套业务库和 Prisma schema，负责轮询 Seedance 视频任务状态、写回结果、下载视频、上传 GCS。
3. `admin/server` + `admin/web`
   管理后台。后端基于 Fastify，前端基于 Vue 3 + Ant Design Vue，负责用户、项目、任务、Prompt、全局配置、审计等运营能力。
4. `MMFC-canvas/`
   独立的 Vue Flow 画布前端。构建后并不是独立部署到单独域名，而是被打包进 `web` 的静态资源，通过 `/ai-canvas` 页面的 iframe 在主站内加载。

这四块共享一个 PostgreSQL 数据库，但职责边界明确：

- `web` 面向普通创作者；
- `worker` 面向异步任务执行；
- `admin` 面向运营与系统管理；
- `MMFC-canvas` 面向可视化 AI 创作体验。

---

## 2. 总体架构

### 2.1 逻辑架构

```text
浏览器
  ├─ 用户端页面（Next.js / web）
  │    ├─ 页面渲染
  │    ├─ /api/projects/*
  │    ├─ /api/storyboards/*
  │    ├─ /api/videos/*
  │    └─ /api/canvas/*
  │
  ├─ 管理后台页面（admin/web）
  │    └─ 调用 Fastify 管理 API
  │
  └─ AI Canvas（MMFC-canvas）
       └─ 在 Next.js 页面中通过 iframe 同源加载

服务端
  ├─ Next.js 应用（web）
  ├─ Worker 轮询进程（web/src/worker）
  └─ Fastify 管理 API（admin/server）

数据层
  └─ PostgreSQL（共享主库）

外部能力
  ├─ Google Gemini
  │    ├─ 分镜生成
  │    ├─ Canvas 聊天
  │    └─ Canvas 生图 / 图像编辑
  ├─ BytePlus Seedance
  │    ├─ 视频任务创建
  │    └─ 视频任务状态查询
  └─ Google Cloud Storage（可选）
       ├─ 视频归档
       └─ Canvas 图片归档
```

### 2.2 部署架构

根目录 `docker-compose.yml` 定义了完整部署编排：

- `postgres`：PostgreSQL 16
- `db-init`：初始化数据库 schema、种子数据、可选 Prompt 导入
- `web-app`：Next.js 用户端
- `web-worker`：任务轮询 Worker
- `admin-api`：Fastify 管理 API
- `admin-web`：管理后台前端

其中 `web-app` 和 `web-worker` 使用同一个 `web/Dockerfile` 构建，确保主站与 Worker 使用相同依赖和 Prisma client。

---

## 3. 仓库结构说明

### 3.1 根目录

```text
.
├── README.md
├── docker-compose.yml
├── .env.docker.example
├── ARCHITECTURE.md
├── docs/                    # 业务/运维说明，含旧版架构文档
├── web/                     # 用户端 + Canvas API + Worker
├── admin/                   # 管理后台
├── MMFC-canvas/             # Vue Flow AI 画布前端
├── files/                   # Prompt / schema 原始文件备份
└── backups/                 # 数据库备份
```

### 3.2 `web/`

`web/` 不是纯前端目录，它同时承担：

- 页面 UI；
- 对外业务 API；
- NextAuth 认证；
- Prisma 数据访问；
- Gemini / Seedance 服务封装；
- Canvas 存储、鉴权、配额逻辑；
- Worker 进程源码。

关键子目录：

```text
web/
├── src/app/                 # Next.js App Router 页面与 Route Handlers
├── src/components/          # React 组件与 shadcn/ui 封装
├── src/lib/                 # 服务端业务库
│   ├── auth.ts
│   ├── prisma.ts
│   ├── gemini.ts
│   ├── seedance.ts
│   ├── global-config.ts
│   ├── prompt-loader.ts
│   ├── token-logger.ts
│   ├── user-action-logger.ts
│   └── canvas/              # Canvas 专属能力
├── src/worker/              # 异步任务轮询器
├── prisma/                  # 用户端 Prisma schema 与 migrations
└── Dockerfile               # 同时构建 web 与 MMFC-canvas
```

### 3.3 `admin/`

`admin/` 分成三层：

```text
admin/
├── prisma/                  # 共享 schema 的主版本 + seed
├── server/                  # Fastify 管理 API
├── web/                     # Vue 3 管理控制台
└── scripts/                 # schema/seed/prompt 同步脚本
```

管理端 Prisma schema 是更完整的“主版本”，因为其中包含：

- 用户端业务表；
- 管理员表 `AdminUser`；
- 审计日志表 `AuditLog`。

### 3.4 `MMFC-canvas/`

这是独立的 Vue 3 + Vite 应用，负责画布交互与工作流编排。它本身不直接持久化数据库，而是通过 `web/src/app/api/canvas/*` 调用用户端后端接口。

关键目录：

```text
MMFC-canvas/src/
├── views/Canvas.vue         # 主画布页面
├── components/nodes/        # 各类节点 UI
├── components/edges/        # 自定义边
├── hooks/useWorkflowOrchestrator.js
├── stores/                  # 画布状态、项目、主题、API 配置
├── api/                     # 对用户端 /api/canvas/* 等接口的请求封装
└── config/                  # provider / model / workflow 配置
```

---

## 4. 技术栈与职责划分

### 4.1 用户端

- 框架：Next.js 16.2.3
- UI：React 19 + 自建组件 + shadcn/ui
- 认证：NextAuth v5 beta + Credentials Provider
- 校验：Zod
- ORM：Prisma 6
- 主要职责：
  - 用户认证与会话管理
  - 项目、分镜、任务、视频相关业务 API
  - Canvas API 宿主
  - 本地/GCS 资源访问代理

### 4.2 Worker

- 运行方式：`npm run worker` 或容器 `npx tsx src/worker/index.ts`
- 主要职责：
  - 轮询 `GenerationTask`
  - 查询 Seedance 任务状态
  - 写回 token 消耗、任务状态、分镜状态
  - 下载视频到本地
  - 可选上传 GCS

### 4.3 管理后台

- 后端：Fastify 5 + TypeScript + Prisma
- 前端：Vue 3 + Vite + Ant Design Vue + Pinia + ECharts
- 主要职责：
  - 管理用户、项目、任务、Canvas 项目
  - 管理 Prompt 模板与全局配置
  - 管理员认证与 RBAC
  - 审计日志、用户行为日志、Token 统计

### 4.4 Canvas

- 框架：Vue 3 + Vite
- 画布库：Vue Flow
- 状态管理：Pinia + 自定义 stores
- 主要职责：
  - 节点/边编辑
  - 工作流模板编排
  - 聊天补全与提示词润色
  - 文生图 / 图生图 / 图生视频流程调用

---

## 5. 身份认证与权限模型

### 5.1 用户端认证

用户端使用 `web/src/lib/auth.ts`：

- Provider：`Credentials`
- 登录字段：`email` + `password`
- 密码校验：`bcryptjs.compare`
- session 策略：JWT
- 登录页：`/login`

认证时会额外校验 `User.status === ACTIVE`，因此即使账户存在，只要被后台改为 `SUSPENDED` 或 `DISABLED`，用户端登录会失败。

### 5.2 Canvas 的二次鉴权

Canvas API 不直接信任已有 session，而是统一经过 `requireCanvasUser()`：

- 未登录：返回 401
- 用户不存在：返回 401
- 用户状态非 `ACTIVE`：返回 403

这样可以避免 NextAuth session 尚未过期，但后台已经停用用户时仍可继续访问画布。

### 5.3 管理端认证

管理端不复用 NextAuth，而是使用独立 JWT：

- 登录入口：`/api/admin/auth/login`
- secret：`ADMIN_JWT_SECRET`
- 用户实体：`AdminUser`
- 角色：`SUPER_ADMIN` / `ADMIN` / `OPERATOR`

### 5.4 管理端权限控制

`admin/server/src/common/guards/rbac.ts` 提供角色守卫。

典型限制：

- `SUPER_ADMIN`：系统级配置、管理员管理
- `ADMIN`：可修改用户、Prompt、项目、Canvas 项目
- `OPERATOR`：通常偏只读或低风险操作

---

## 6. 核心业务域

系统核心上分为两条主业务线：

1. **短剧/分镜/视频生成链路**
   - `Project`
   - `Storyboard`
   - `GenerationTask`
2. **AI Canvas 创作链路**
   - `CanvasProject`
   - `CanvasNode`
   - `CanvasEdge`
   - `CanvasAsset`
   - `CanvasAiCall`

辅助域包括：

- 用户与配置：`User`、`UserApiConfig`、`GlobalConfig`
- Prompt 体系：`PromptTemplate`、`PromptVersion`
- 可观测性：`TokenUsageLog`、`UserActionLog`、`AuditLog`

---

## 7. 数据模型设计

以下描述基于 `web/prisma/schema.prisma` 与 `admin/prisma/schema.prisma` 当前实现。

### 7.1 用户与账户相关

#### `User`

普通创作者账户。

关键字段：

- `email`：唯一登录标识
- `passwordHash`：bcrypt 哈希
- `status`：`ACTIVE / SUSPENDED / DISABLED`
- `quota`：JSON 配额配置
- `remark`：后台备注

关联：

- 1:N `Project`
- 1:N `UserApiConfig`
- 1:N `TokenUsageLog`
- 1:N `UserActionLog`
- 1:N `CanvasProject`

#### `UserApiConfig`

用户级第三方 API 配置，当前主要用于 Seedance。

关键字段：

- `provider`
- `endpoint`
- `apiKey`
- `model`
- `isDefault`
- `isActive`

设计意图：

- 允许每个用户覆盖默认全局 API；
- Worker 查询任务状态时，如果任务绑定了 `apiConfigId`，会优先解密并使用该用户私有 Key。

#### `GlobalConfig`

全局配置表，用于存放默认模型、API Key、Endpoint 等。

关键点：

- `key` 唯一
- `value` 文本存储
- `encrypted` 标记是否需要 AES 解密
- 运行时有 1 分钟本地缓存

当前代码实际读取的 key 包括但不限于：

- `seedance_api_key`
- `seedance_endpoint`
- `seedance_model`
- `gemini_api_key`
- `gemini_model`
- `gemini_base_url`（Canvas 原生图片接口读取）

### 7.2 分镜视频业务

#### `Project`

表示一个视频创作项目。

关键字段：

- `script`：本次剧集剧本
- `fullScript`：完整剧本/上下文
- `assetsJson`：素材列表
- `assetDescriptions`：角色/场景描述
- `style`：视觉风格
- `ratio`：视频比例
- `resolution`：视频清晰度
- `globalSeed`：全局随机种子
- `creationMode`：`AUTO / MANUAL`
- `status`：项目生命周期状态

设计要点：

- `AUTO` 项目支持调用 Gemini 自动生成分镜；
- `MANUAL` 项目直接进入 `REVIEW`，由人工手动编辑分镜；
- `seedanceEndpoint` 是项目创建时的快照字段，用于保留当时的视频模型/endpoint 环境。

#### `Storyboard`

项目下的单个分镜。

关键字段：

- `storyboardId`：业务编号，如 `s001`
- `sortOrder`：排序
- `duration`
- `prompt`
- `assetBindings`
- `seedanceContentItems`
- `status`

其中：

- `assetBindings` 保存提示词中涉及的资产绑定顺序；
- `seedanceContentItems` 直接保存可提交给 Seedance 的 `reference_image` 内容项。

#### `GenerationTask`

视频生成任务表，对接 Seedance 的异步任务。

关键字段：

- `arkTaskId`：远端任务 ID，唯一
- `status`：本地任务状态
- `arkStatus`：远端原始状态
- `videoUrl`：远端返回的视频地址
- `localVideoPath`
- `gcsVideoPath`
- `completionTokens`
- `totalTokens`
- `error`
- `apiConfigId`

本地 `status` 使用以下枚举：

- `SUBMITTED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `PERSISTING`
- `PERSISTED`

这说明系统明确区分了：

1. 远端任务已经完成；
2. 本地视频文件还在落盘/上传；
3. 本地归档彻底完成。

### 7.3 Prompt 与可观测性

#### `PromptTemplate` + `PromptVersion`

用于把核心 Prompt 从代码中抽离到数据库：

- `slug` 唯一，作为运行时查找键
- `category`：`SYSTEM_PROMPT / JSON_SCHEMA / USER_PROMPT`
- `version`：当前版本号
- `versions`：历史版本记录

当前关键 Prompt：

- `director_system`
- `storyboard_schema`
- `user_prompt_template`

运行时通过 `prompt-loader.ts` 读取：

- 本地 5 分钟缓存
- 如果数据库中是占位文本 `[待从代码库导入]`，自动回退到代码内 fallback

#### `TokenUsageLog`

记录 Gemini / Seedance 相关 token 消耗。

用途：

- 用户维度统计
- provider/model 维度统计
- 管理后台趋势图和 CSV 导出

#### `UserActionLog`

记录普通用户行为事件。

用途：

- 项目/任务/Canvas 行为追踪
- 辅助定位问题
- 管理端查看用户操作轨迹

### 7.4 Canvas 业务

#### `CanvasProject`

画布项目主表。

关键字段：

- `name`
- `thumbnail`
- `viewport`
- `status`

状态：

- `ACTIVE`
- `ARCHIVED`
- `DELETED`

删除采用软删，原因是节点、边、资源可能仍需后台清理或恢复。

#### `CanvasNode`

画布节点。

关键特点：

- 主键不是单列 ID，而是复合主键 `@@id([projectId, id])`
- `position` 与 `data` 都是 JSON

这意味着：

- 节点 ID 只要求在项目内唯一；
- 不同项目允许重用相同节点 ID；
- 更适合前端画布模型的自然结构。

#### `CanvasEdge`

画布连线，同样使用复合主键 `@@id([projectId, id])`。

字段保存：

- `source`
- `target`
- `sourceHandle`
- `targetHandle`
- `type`
- `data`

#### `CanvasAsset`

画布资产表，保存上传图、生成图、生成视频的元数据。

关键字段：

- `kind`
- `mimeType`
- `bytes`
- `localPath`
- `gcsPath`
- `publicUrl`
- `sourceNodeId`

注意：

- `publicUrl` 不是外网公开对象地址，而是系统内部访问入口，如 `/api/canvas/assets/:id`；
- 真正的读操作仍然经过鉴权。

#### `CanvasAiCall`

记录画布相关 AI 调用，用于配额和统计。

当前典型 `callType`：

- `canvas_chat`
- `canvas_image`
- `canvas_image_edit`

用途：

- 统计每日生图次数
- 统计每日聊天 token
- 后台做 Canvas 维度报表

---

## 8. 状态机设计

### 8.1 项目状态 `ProjectStatus`

```text
DRAFT
  ├─(AI 生成分镜)→ GENERATING_STORYBOARDS
  │                   ├─成功→ REVIEW
  │                   └─失败→ FAILED
  │
  └─(手动项目创建)→ REVIEW

REVIEW
  ├─(提交视频)→ GENERATING_VIDEOS
  ├─(重新生成分镜)→ GENERATING_STORYBOARDS
  └─(流程失败)→ FAILED

GENERATING_VIDEOS
  ├─(任务逐步完成)→ 业务上仍停留该状态
  └─(后续可由页面/逻辑收敛到 COMPLETED 或 FAILED)

COMPLETED / FAILED
  └─允许部分操作重新触发
```

说明：

- 代码里对项目完成态的收敛没有完全中心化在 Worker；更多是通过分镜/任务状态来体现进度。
- `generate-storyboards` 接口允许 `DRAFT / FAILED / REVIEW / COMPLETED` 再次触发生成，因此项目支持重复迭代。

### 8.2 分镜状态 `StoryboardStatus`

```text
DRAFT / APPROVED / FAILED
  └─提交任务→ SUBMITTED

SUBMITTED
  └─Worker 轮询中→ GENERATING

GENERATING
  ├─任务成功→ SUCCEEDED
  └─任务失败→ FAILED
```

### 8.3 任务状态 `TaskStatus`

```text
SUBMITTED
  └─轮询到远端开始执行→ RUNNING

RUNNING
  ├─远端失败→ FAILED
  └─远端成功→ SUCCEEDED

SUCCEEDED
  └─触发本地归档→ PERSISTING

PERSISTING
  └─本地/云端持久化完成→ PERSISTED
```

---

## 9. 用户端页面架构

### 9.1 路由结构

`web/src/app` 当前主要页面：

- `/`：根据登录态重定向到 `/dashboard` 或 `/login`
- `/login`
- `/register`
- `/(app)/dashboard`
- `/(app)/projects/new`
- `/(app)/projects/[id]`
- `/ai-canvas`

### 9.2 页面职责

#### `/dashboard`

项目列表入口，作为用户工作台。

#### `/projects/new`

项目创建页，支持两种模式：

- `AUTO`：创建后可调用 AI 生成分镜
- `MANUAL`：直接进入人工维护分镜

#### `/projects/[id]`

单项目详情页，承担：

- 展示项目信息
- 展示分镜与任务
- 编辑分镜 prompt / duration / 资产绑定
- 触发单个或批量提交
- 播放或下载视频

#### `/ai-canvas`

这是一个 React 页面，但不直接实现画布，而是：

- 渲染同源 iframe，地址 `/canvas/`
- 监听来自 iframe 的 `postMessage`
- 作为 Canvas SPA 的宿主壳层

设计意义：

- 画布可复用主站登录态 cookie；
- 画布前端可独立开发、独立构建；
- 用户仍在主站域名内，不需要额外 SSO。

---

## 10. 用户端 API 架构

用户端 Route Handlers 主要分为三组：

1. 项目/分镜/视频业务
2. 认证业务
3. Canvas 业务

### 10.1 认证接口

#### `/api/auth/[...nextauth]`

由 NextAuth handlers 接管。

#### `/api/auth/register`

用于新用户注册。

### 10.2 项目接口

#### `GET /api/projects`

查询当前用户所有项目，按创建时间倒序，附带分镜数量。

#### `POST /api/projects`

创建项目。

请求体根据 `creationMode` 走两套 schema：

- `AUTO`：要求完整剧本和风格等字段
- `MANUAL`：允许更轻量输入

行为差异：

- `MANUAL` 创建后直接写入 `status=REVIEW`
- `AUTO` 默认走初始态

#### `GET /api/projects/:id`

查询单项目详情，带：

- storyboards
- 每个 storyboard 下的 tasks（按时间倒序）

#### `PATCH /api/projects/:id`

更新项目基础信息。

限制：

- `GENERATING_STORYBOARDS`
- `GENERATING_VIDEOS`

这两种状态下禁止编辑。

### 10.3 分镜生成接口

#### `POST /api/projects/:id/generate-storyboards`

系统最关键的 AI 入口之一。

执行流程：

1. 校验登录与项目归属
2. 校验不是 `MANUAL` 项目
3. 校验项目状态允许生成
4. 把项目状态改为 `GENERATING_STORYBOARDS`
5. 记录用户行为日志
6. 调用 `generateStoryboards()` 发给 Gemini
7. 记录 token 消耗
8. 计算新分镜编号与排序起点
9. 批量写入 `Storyboard`
10. 把项目状态改为 `REVIEW`

失败时：

- 项目状态改为 `FAILED`
- 写用户行为日志

### 10.4 分镜维护接口

#### `PATCH /api/storyboards/:id`

更新单个分镜：

- `prompt`
- `duration`
- `assetBindings`
- `seedanceContentItems`

其中 `duration` 通过 `isValidManualStoryboardDuration` 校验，支持手工分镜更短时长。

#### `POST /api/storyboards/:id/submit`

提交单个分镜给 Seedance。

流程：

1. 找到用户默认的 `UserApiConfig(provider=seedance)`
2. 若存在则解密 `apiKey`
3. 调用 `createSeedanceTask`
4. 新建 `GenerationTask`
5. 分镜状态置为 `SUBMITTED`

#### `POST /api/projects/:id/submit-batch`

批量提交多个分镜。

特点：

- 输入 `storyboardIds`
- 仅提交 `DRAFT / FAILED / APPROVED` 的分镜
- 逐条调用 Seedance
- 每个分镜独立收集成功/失败结果
- 项目状态统一更新为 `GENERATING_VIDEOS`

### 10.5 视频访问接口

#### `GET /api/videos/:taskId`

带鉴权的视频读取接口。

查找顺序：

1. `GenerationTask.localVideoPath`
2. `{storyboardId}_{arkTaskId}.mp4`
3. 历史兼容文件名 `{arkTaskId}.mp4`
4. 若本地没有但 `videoUrl` 存在，则 302 跳转远端地址

支持 `?download=1` 触发下载头。

---

## 11. Gemini 集成设计

### 11.1 分镜生成

入口：`web/src/lib/gemini.ts`

输入包括：

- 当前剧本
- 完整剧本
- 资产列表 JSON
- 资产描述 JSON
- 风格描述

运行时 Prompt 来源：

- 系统提示词：优先数据库 `director_system`，否则 fallback 代码常量
- 响应 schema：优先数据库 `storyboard_schema`
- 用户提示词模板：优先数据库 `user_prompt_template`

调用方式：

- Google 原生 `generateContent`
- 强制 `responseMimeType: application/json`
- 传入 `responseSchema`

实现细节：

- 兼容 Gemini 返回多个 parts；
- 会过滤 `thought=true` 的思考片段；
- 提取 `usageMetadata`；
- 如果输出为空，明确构造错误信息，避免沉默失败。

### 11.2 Canvas 聊天

入口：`POST /api/canvas/chat`

特点：

- 使用 Gemini OpenAI 兼容接口 `/openai/chat/completions`
- 采用 SSE 流式透传
- 同时在服务端解析流，累计 usage
- 如果上游没带 usage，则用字符数粗估输出 token

额外能力：

- 支持把 `/api/canvas/assets/:id` 引用自动转成 data URL
- 允许聊天消息里携带参考图

### 11.3 Canvas 生图

入口：`POST /api/canvas/images`

特点：

- 使用 Gemini 原生图片生成接口 `models/:model:generateContent`
- 强制 `responseModalities: ["IMAGE"]`
- 支持纯文生图与多参考图编辑
- 统一落盘并登记为 `CanvasAsset`

---

## 12. Seedance 集成设计

入口：`web/src/lib/seedance.ts`

### 12.1 任务创建

`createSeedanceTask()` 解析配置优先级：

1. 显式传入的用户级 `config`
2. `GlobalConfig`
3. 环境变量

请求体包含：

- `model`
- `content`
- `generate_audio: true`
- `ratio`
- `resolution`
- `duration`
- `watermark: false`
- `seed`（可选）

其中 `content` 由：

- 文本 prompt
- `seedanceContentItems`

拼接而成。

### 12.2 状态查询

`getTaskStatus()` 同样支持用户私有 Key 或全局 Key。

返回字段被 Worker 用于写回：

- `status`
- `content.video_url`
- `usage`
- `seed`
- `resolution`
- `ratio`
- `duration`
- `error`

---

## 13. Worker 架构

Worker 代码位于 `web/src/worker/index.ts`。

### 13.1 轮询策略

- 轮询间隔：`WORKER_POLL_INTERVAL`，默认 15000ms
- 批次大小：`BATCH_SIZE = 20`
- 查询范围：`GenerationTask.status in (SUBMITTED, RUNNING)`

### 13.2 单任务处理流程

对于每个活跃任务：

1. 如果任务关联 `apiConfig`，先尝试解密用户私有 API Key
2. 调用 `getTaskStatus()`
3. 根据返回状态分支处理：
   - `succeeded`
   - `failed`
   - 其他运行中状态

### 13.3 成功分支

成功时会：

1. 更新 `GenerationTask`
2. 写 `UserActionLog`
3. 写 `TokenUsageLog`
4. 更新 `Storyboard.status = SUCCEEDED`
5. 异步触发 `persistVideo()`

注意：`persistVideo()` 没有 `await` 外部串行链路中的更多状态汇总，这说明设计偏向“任务先完成、归档随后进行”。

### 13.4 视频持久化

`persistVideo()` 内部流程：

1. 把任务状态设为 `PERSISTING`
2. 记录行为日志
3. 构造统一文件基名 `{storyboardId}_{arkTaskId}`
4. 下载视频到本地目录 `VIDEO_STORAGE_PATH`
5. 如果配置了 `GCS_BUCKET`，上传到 GCS
6. 更新 `GenerationTask.localVideoPath / gcsVideoPath / status=PERSISTED`

### 13.5 失败分支

失败时：

- 更新任务状态 `FAILED`
- 写错误信息
- 记录用户行为日志
- 更新分镜状态 `FAILED`

### 13.6 当前设计的显式取舍

优点：

- 结构简单，易于理解
- 不需要额外消息队列
- 与数据库状态一致性较强

限制：

- 轮询方式天然有延迟
- Worker 横向扩容时需要注意重复轮询与并发更新
- 项目级“全部完成”状态回收目前不够中心化

---

## 14. Canvas 架构

### 14.1 集成方式

Canvas 并未直接写进 Next.js 组件体系，而是采用“独立前端 + 主站宿主”的模式：

1. `MMFC-canvas` 独立开发、独立构建
2. `web/Dockerfile` 在构建时先编译 Canvas
3. 产物复制到 `web/public/canvas`
4. 主站 `/ai-canvas` 页面通过 `<iframe src="/canvas/">` 加载

这使得：

- Canvas 前端可以维持 Vue 技术栈；
- 主站继续维持 React / Next.js；
- 两者通过同源 cookie 和 HTTP API 协作。

### 14.2 画布数据持久化

Canvas 持久化接口：`PUT /api/canvas/projects/:id/snapshot`

采用的是**全量快照覆写**而不是 diff 更新：

1. 校验 payload 中 node/edge ID 无重复
2. 事务内锁定 `CanvasProject`
3. 删除旧 edges
4. 删除旧 nodes
5. 批量创建新 nodes
6. 批量创建新 edges
7. 更新 viewport / thumbnail

这样做的原因很明确：

- Vue Flow 前端天然维护完整状态快照；
- 服务端 diff 逻辑复杂，容易出错；
- 在项目级范围内全量替换更可控。

同时接口阻止“误保存空画布”：

- 当已有内容，但新快照为空时；
- 需要显式传 `confirmEmptySnapshot: true`；
- 否则返回 409。

### 14.3 Canvas 资源存储

资源写入逻辑在 `web/src/lib/canvas/canvas-storage.ts`。

策略：

- 本地目录：`IMAGE_STORAGE_PATH`，默认 `./data/canvas-images`
- 路径结构：`/{userId}/{projectId}/{assetId}.{ext}`
- 可选上传 GCS
- `publicUrl` 固定返回 `/api/canvas/assets/:id`

设计价值：

- 把真实存储位置与业务访问 URL 解耦；
- 后续替换底层存储无需改前端协议；
- 所有读取都能走统一鉴权。

### 14.4 Canvas 配额

`User.quota` 当前支持：

- `daily_image_limit`
- `daily_chat_tokens`

校验方式：

- 从 `CanvasAiCall` 统计当天成功调用
- 生图用 `imageCount`
- 聊天用 `totalTokens`

这意味着 Canvas 配额与主站视频生成配额是松耦合的，便于后续单独演进。

### 14.5 Workflow Orchestrator

`MMFC-canvas/src/hooks/useWorkflowOrchestrator.js` 是前端画布的关键编排器。

主要职责：

- 根据用户输入判断工作流类型
- 生成节点
- 串行等待上一步完成
- 把输出节点作为下一步输入

当前内建工作流类型：

- `text_to_image`
- `text_to_image_to_video`
- `storyboard`
- `multi_angle_storyboard`
- `picture_book`

可以看出 Canvas 不是简单的“节点编辑器”，而是“节点编辑器 + 意图驱动编排器”的混合体。

---

## 15. 管理后台架构

### 15.1 Fastify 应用装配

入口：`admin/server/src/app.ts`

应用启动时注册：

- CORS
- JWT
- 各业务模块 routes
- `/api/admin/health`

模块列表：

- `auth`
- `user`
- `project`
- `task`
- `api-config`
- `global-config`
- `prompt`
- `token-usage`
- `dashboard`
- `audit-log`
- `admin-mgmt`
- `canvas-projects`
- `user-action-log`

### 15.2 管理端核心模块

#### Auth

- 登录
- 刷新 token
- 当前管理员资料
- 修改密码

#### User

- 用户列表
- 用户详情
- 修改用户状态与配额等
- 重置密码

#### Project

- 项目列表
- 项目详情（含分镜/任务）
- 删除项目

#### Task

- 任务列表
- 任务详情
- 重试任务
- 实时统计

#### API Config

- 管理用户的第三方 API 配置
- 测试连通性

#### Prompt

- Prompt 模板 CRUD
- 发布新版本
- 回滚历史版本
- 查看版本历史

#### Global Config

- 管理全局 API Key / model / endpoint

#### Token Usage

- 概览汇总
- 按用户统计
- 按 provider 统计
- 明细查询
- CSV 导出
- Canvas 维度统计

#### Canvas Projects

- Canvas 项目列表
- 详情
- 归档/状态修改
- 删除并清理资源

#### User Action Log / Audit Log

- 用户行为日志：记录普通用户操作
- 审计日志：记录管理员操作

这是两个不同层级的可观测性系统，不应混淆。

### 15.3 管理前端

`admin/web` 使用 Vue 3 + Ant Design Vue。

页面包括：

- 登录页
- 仪表盘
- 用户列表/详情
- 项目列表/详情
- 任务列表/详情
- Prompt 列表/编辑
- Token 统计
- 审计日志
- 用户行为日志
- Canvas 项目列表/详情
- 全局配置
- 管理员列表

管理前端通过 `src/api/*` 中的请求封装访问 Fastify API。

---

## 16. 配置体系

系统配置来源有四层：

1. 硬编码 fallback
2. 环境变量
3. `GlobalConfig`
4. `UserApiConfig`

不同能力的优先级略有差别，但总体原则是：

- 用户私有配置优先于系统默认；
- 数据库配置优先于环境变量；
- 环境变量优先于代码默认值。

### 16.1 典型配置项

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `ENCRYPTION_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_BASE_URL`
- `SEEDANCE_API_KEY`
- `SEEDANCE_ENDPOINT`
- `SEEDANCE_MODEL`
- `VIDEO_STORAGE_PATH`
- `IMAGE_STORAGE_PATH`
- `GCS_BUCKET`
- `GCS_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `ADMIN_JWT_SECRET`
- `CORS_ORIGIN`
- `WORKER_POLL_INTERVAL`

### 16.2 加密配置

需要加密存储的字段会通过 `ENCRYPTION_KEY` 进行 AES-256-GCM 加解密，典型场景：

- `GlobalConfig` 中标记 `encrypted=true` 的值
- `UserApiConfig.apiKey`

---

## 17. 数据初始化与 schema 管理

### 17.1 db-init

`docker-compose.yml` 中的 `db-init` 容器负责初始化数据库：

1. `prisma db push`
2. `tsx prisma/seed.ts`
3. 按开关决定是否 `seed-prompts`

### 17.2 Seed 内容

`admin/prisma/seed.ts` 会初始化：

- 默认超级管理员 `admin / admin123456`
- Prompt 模板占位记录
- 全局配置 key 占位记录

注意：

- Prompt 首次 seed 并不写入完整真实内容；
- 只写入 `[待从代码库导入]` 占位文本；
- 运行时 `prompt-loader` 遇到占位时会 fallback 到代码常量。

### 17.3 Prompt 导入

`SEED_PROMPTS_FROM_CODE=1` 时：

- `db-init.sh` 会继续执行 `admin/scripts/seed-prompts.ts`
- 从 `web/src/lib/prompts/*` 与 `web/src/lib/gemini.ts` 提取 Prompt/Schema

这套设计是为了避免每次部署都用代码覆盖数据库中已经维护过的 Prompt。

---

## 18. Docker 构建与发布链路

### 18.1 `web/Dockerfile`

这个 Dockerfile 是整个仓库里最特殊的构建脚本之一，因为它同时处理两个子应用：

1. 安装 `web` 依赖
2. 安装 `MMFC-canvas` 依赖
3. 构建 `MMFC-canvas`
4. 把 Canvas 产物复制到 `web/public/canvas`
5. 构建 Next.js
6. 准备生产运行镜像

额外拷贝内容包括：

- Prisma client
- `src/worker` 源码
- `tsx` 与若干运行期依赖

这样同一镜像既能跑：

- `web-app`
- `web-worker`

### 18.2 `admin/server/Dockerfile`

负责：

- 安装 server 依赖
- 生成 Prisma client
- 编译 TypeScript
- 拷贝 `admin/prisma`
- 拷贝 `seed-prompts.ts` 和 `db-init.sh`
- 拷贝 `web` 里的 Prompt 源文件，供初始化使用

### 18.3 `admin/web/Dockerfile`

是标准的前端静态构建流程：

1. `npm ci`
2. `npm run build`
3. 用 `nginx:alpine` 托管

---

## 19. 日志、审计与可观测性

### 19.1 用户行为日志

普通用户的重要业务动作都会写入 `UserActionLog`，例如：

- 登录
- 创建项目
- 生成分镜
- 提交任务
- 任务状态变化
- Canvas 项目创建/更新/删除
- Canvas 资产上传/生成

价值：

- 还原用户侧操作链
- 排查“某个任务为什么失败”
- 为管理后台提供行为审计视图

### 19.2 管理员审计日志

管理员改动通过 `AuditLog` 记录，和用户行为日志分离。

价值：

- 记录谁改了用户状态、Prompt、配置、项目
- 满足后台治理需要

### 19.3 Token 日志

系统把 AI 使用量拆成两套：

- `TokenUsageLog`：主站 Gemini / Seedance 维度
- `CanvasAiCall`：Canvas 调用维度

这是出于业务维度分离考虑：

- 主站更偏“项目/任务”
- Canvas 更偏“交互式创作”

---

## 20. 关键设计决策与取舍

### 20.1 为什么仓库内同时存在 React/Next 和 Vue/Vite

这是历史与现实折中后的结果：

- 用户主站选择了 Next.js，适合认证、SSR、API 共置；
- 管理台已有 Vue 技术栈；
- Canvas 强依赖 Vue Flow，独立成 Vue 应用开发成本更低。

当前做法不是“统一技术栈”，而是“通过同源 API 和构建集成统一产品体验”。

### 20.2 为什么 Worker 用数据库轮询而不是消息队列

原因很直接：

- 当前任务模型简单；
- 任务来源集中在数据库；
- 使用轮询减少基础设施复杂度。

代价也明确：

- 任务状态更新非实时；
- 高并发场景下扩展性一般；
- 需要靠状态字段避免重复处理。

### 20.3 为什么 Canvas 快照用全量覆写

因为前端画布维护的是完整图结构，后端做 diff：

- 更复杂；
- 更难保证一致性；
- 更难处理节点 ID 复用与批量删除。

全量覆写虽然粗，但更稳定、更容易验证。

### 20.4 为什么 Prompt 放数据库但仍保留代码 fallback

因为 Prompt 同时有两种需求：

- 需要在后台动态运营调整；
- 不能因为数据库还没初始化就让核心功能不可用。

所以当前采取“双轨”：

- DB 优先；
- 代码兜底。

---

## 21. 当前架构的风险点与演进建议

以下不是缺陷清单，而是从代码结构能直接看出的架构关注点。

### 21.1 项目完成态缺少集中收敛

当前任务和分镜状态更新较完整，但项目何时从 `GENERATING_VIDEOS` 进入 `COMPLETED` 的逻辑并不集中。后续如果要增强看板准确性，建议：

- 在 Worker 中增加项目级聚合收敛；
- 或在查询层统一计算派生状态。

### 21.2 用户端与管理端 schema 双份维护

虽然两边 schema 基本同步，但仍是两份文件：

- `web/prisma/schema.prisma`
- `admin/prisma/schema.prisma`

长期风险是漂移。仓库已有 `admin/scripts/sync-schema.sh`，但如果后续频繁改表，建议进一步收敛为单源生成或至少强制检查。

### 21.3 Worker 并发与幂等需要留意

如果未来部署多个 Worker 副本，需要额外考虑：

- 同一任务被多个副本同时拉到；
- 同时写状态；
- 同时持久化视频。

当前状态字段和数据库唯一约束能挡住一部分问题，但还不是严格的分布式锁方案。

### 21.4 本地文件与数据库的一致性

视频和 Canvas 资产都依赖本地磁盘路径记录。若运维侧手工删除文件或迁移卷，数据库中路径可能失效。当前实现已经做了较好的 fallback：

- 视频可跳转远端 `videoUrl`
- Canvas 资源可尝试从 `gcsPath` 拉回

但这仍要求生产环境明确主存储策略。

---

## 22. 快速阅读指引

如果你是新接手这个仓库的开发者，推荐按下面顺序阅读代码：

1. 根目录 `README.md`
2. `docker-compose.yml`
3. `web/prisma/schema.prisma`
4. `admin/prisma/schema.prisma`
5. `web/src/app/api/projects/*`
6. `web/src/lib/gemini.ts`
7. `web/src/lib/seedance.ts`
8. `web/src/worker/index.ts`
9. `web/src/app/api/canvas/*`
10. `web/src/lib/canvas/*`
11. `admin/server/src/app.ts`
12. `admin/server/src/modules/*`
13. `MMFC-canvas/src/views/Canvas.vue`
14. `MMFC-canvas/src/hooks/useWorkflowOrchestrator.js`

---

## 23. 一句话总结

这个仓库本质上是一个“共享数据库的多应用系统”：

- Next.js 负责创作者主流程与 API 宿主；
- Worker 负责异步视频任务闭环；
- Fastify + Vue 负责后台治理；
- MMFC-canvas 负责可视化 AI 创作；
- PostgreSQL 负责把这些能力收束到同一个业务数据面上。

理解这一点，后续无论是改业务、拆服务、补监控，都会更容易判断边界。
