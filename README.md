# Creator MMFC

**版本：1.5.2**

面向分镜与视频创作的一体化平台：用户端（Next.js）、异步 Worker、管理后台（Fastify + Vue），并集成 **MMFC Studio Canvas**（Vue Flow 可视化 AI 画布）。数据层使用 **PostgreSQL**，可选 **GCS** 做对象存储。

## 仓库结构

| 目录 | 说明 |
|------|------|
| [`web/`](web/) | 用户端：Next.js（App Router）、NextAuth、分镜/项目 API、画布相关 `/api/canvas/*` 与 `/ai-canvas` 入口 |
| [`web/worker`](web/src/worker) | 视频等异步任务 Worker（与 `web-app` 共用镜像，独立进程） |
| [`MMFC-canvas/`](MMFC-canvas/) | 画布前端（Vite + Vue 3）；生产构建由根目录 [`web/Dockerfile`](web/Dockerfile) 一并打入用户端镜像 |
| [`admin/server/`](admin/server) | 管理端 API：Fastify + Prisma |
| [`admin/web/`](admin/web) | 管理端控制台：Vue 3 + Ant Design Vue |
| [`admin/prisma/`](admin/prisma) | 与用户端共享的数据库 schema / seed |
| [`docs/`](docs/) | 运维与业务说明（如 [`docs/operations-guide.md`](docs/operations-guide.md)） |
| [`docker-compose.yml`](docker-compose.yml) | 全套服务编排：Postgres、`db-init`、用户端、Worker、管理 API、管理 Web |

更细的模块说明见：

- [管理后台说明](admin/README.md)
- [MMFC-canvas 画布说明](MMFC-canvas/README.md)
- [系统架构说明](ARCHITECTURE.md)（模块边界、数据流、部署与模型）

---

## 当前功能总览

### 用户端 `web/`

- 邮箱密码注册 / 登录（NextAuth + Credentials）
- 项目创建、项目列表、项目详情
- 剧本转分镜、分镜克隆、批量提交视频任务、批量下载结果
- `/ai-canvas` 入口与同源 Canvas API（聊天、配置、图片任务、素材访问）

### AI 画布 `MMFC-canvas/`

- Vue Flow 可视化节点编排：文本、文生图、图片、视频配置、视频节点
- 画布聊天、提示词润色、工作流模板、自动执行
- 文生图 / 图生图异步任务恢复：关 tab、刷新、断网后可续轮询
- 项目内素材管理、批量下载、API 设置、模型/凭据选择

### Worker `web/src/worker/`

- Seedance 视频任务轮询、状态落库、视频下载与可选 GCS 上传
- Canvas 生图任务轮询、僵尸任务回收、资产落盘、审计日志与费用估算

### 管理后台 `admin/server` + `admin/web`

- 仪表盘、用户 / 项目 / 视频任务 / 画布项目管理
- Prompt 模板管理：版本历史、回滚、Schema 测试、按 provider 适配
- 凭据池管理：CRUD、连通性探测、主用凭据、用途/模型粒度适用范围
- 默认模型管理、模型注册表、用户行为日志、审计日志、Token 统计

---

### 版本 1.5.2 更新摘要

**主要优化：补齐分镜 seed、草稿删除、画布图片参数语义与动态计费链路**

#### 1. 工作台分镜体验补齐

- 视频预览弹窗标题增加分镜号，关闭弹窗后仍能明确刚刚查看的是哪一镜
- `DRAFT` 且从未生成过任务的分镜支持前端确认后删除；后端新增 `DELETE /api/storyboards/[id]` 做归属、状态、任务数强校验
- 分镜新增可选 `seed` 字段；提交视频时按 `storyboard.seed ?? project.globalSeed ?? randomSeed` 解析实际 seed，并在创建 `GenerationTask` 时立即落库

#### 2. 画布图片模型参数与输入修复

- 修复 TextNode、LLMConfigNode 中 `@图片` 后紧跟文字时，mention 插入吞掉后续文本的问题
- 画布图片模型统一使用“比例 / 分辨率(质量)”语义，继续兼容现有 `size` / `quality` 字段
- `MMFC-canvas` 在未配置模型专属选项时也会回退默认比例与分辨率选项，避免下拉为空

#### 3. Admin 模型配置与成本统计对齐

- Provider 凭据页 Base URL 增加分 provider 的明确格式说明（OpenAI Compatible / Azure OpenAI / Google Gemini / Custom）
- ModelRegistry 继续使用 `sizes` / `qualities` 存储，但 UI 文案明确为 ratios / resolutions，并支持 `capabilities.pricing`
- 画布 chat / image 成本估算优先读取 ModelRegistry `capabilities.pricing`，找不到再 fallback 到内置价表
- `CanvasAiCall` 新增 `costEstimate` 字段；chat 在上游未返回 usage 时会补 input/output token 估算

---

### 版本 1.5.1 更新摘要

**主要修复：画布图生图在 `gpt-image-2` 路径下的两处兼容问题**

#### 1. 修复模型路由与多参考图提交兼容性

- 统一 `canvas_image_edit` 下 `gpt-image-2` 的模型 key，避免图生图任务错误回退到 Gemini `generateContent`
- `web/src/lib/llm/image.ts` 在多参考图时改为提交 `image[]`，兼容当前 Azure/OpenAI 网关对 multipart 数组参数的要求

#### 2. 修复画布 `@图片` 引用导致的重复参考图

- `MMFC-canvas/src/components/nodes/ImageConfigNode.vue` 在汇总 `@` 引用图片和边连接图片时增加去重
- 避免同一 `CanvasAsset` 被重复提交两次，引发 `Duplicate parameter: 'image'` 错误

---

### 版本 1.5.0 更新摘要

**主要特性：多 Provider 配置体系补全为“凭据池 + 模型注册表 + Prompt 版本化 + 画布异步任务恢复”的闭环**

#### 1. 凭据池进入“按用途 / 按模型”精细匹配

- `ProviderCredential` 新增 `purposes`、`modelKeys` 两个作用域字段
- `web/src/lib/llm/credential-resolver.ts` 按 `purpose + modelKey + provider 优先级` 解析凭据
- 画布侧 `/api/canvas/config` 直接下发 `models / credentials / defaults`，前端可按模型展示可选凭据

#### 2. 管理后台补齐模型与凭据运营能力

- 新增 `/system/credentials`：凭据 CRUD、主用切换、连通性测试、用途/模型范围配置
- 新增 `/system/defaults`：四类用途的默认模型指针配置
- 新增 `/system/model-registry`：模型能力、尺寸、质量、排序、启停管理
- 原 `/system/providers` 降级为迁移提示页，避免旧心智继续写死 provider

#### 3. Prompt 体系升级为可运营版本库

- `PromptTemplate` 支持 `applicableProviders`
- 后台支持版本历史、回滚、发布、JSON Schema 在线测试
- `web/src/lib/prompt-loader.ts` 运行时优先按 provider 命中 prompt，未命中再回退通用模板

#### 4. 画布异步任务链路落地到生产可恢复形态

- `CanvasImageTask` 持续承担文生图 / 图生图在途状态
- Worker 启动时自动回收僵尸 `RUNNING` 任务
- `ImageNode` / `ImageConfigNode` 持久化 `activeTaskId`，重新进入项目后自动续轮询
- 统一图片成本估算，`CanvasAiCall`、`UserActionLog`、`TokenUsageLog` 可串起调用审计

#### 5. 本次文档同步额外补充

- README 与架构文档已按当前仓库实际结构重写版本信息
- 补充“当前功能总览”和“代码优化项”，便于后续迭代排期

---

### 版本 1.4.0 更新摘要

**主要特性：画布生图改为后端异步任务 + 前端轮询恢复**

`gpt-image-1`、慢 Gemini 等画布生图调用经常 5–40 分钟级耗时，旧的同步 HTTP 请求会被任意一环（浏览器/CDN/反向代理）超时打断。1.4.0 起把生图链路改为"后端任务 + 前端轮询"，**任意时刻关 tab、刷新、断网都不会丢任务**。

#### 1. 数据模型：`CanvasImageTask`

新增任务状态机表，与 `CanvasAiCall`（事后审计）严格分工——前者是"在途状态"，后者是"完成事件"。

| 字段 | 含义 |
|------|------|
| `status` | `PENDING / RUNNING / SUCCEEDED / FAILED` |
| `model / credentialId / prompt / size / quality / isEdit` | 输入快照 |
| `refImagesSnapshot` | 参考图原始输入数组（asset paths / data URLs / http URLs），由 worker 还原成 base64 |
| `resultAssetIds` | 成功时：`CanvasAsset.id` 数组 |
| `revisedPrompt / costEstimate / durationMs / upstreamProvider` | 完成元数据 |
| `error / attempts` | 失败信息 + 重试计数 |
| `startedAt / finishedAt / createdAt / updatedAt` | 时间戳 |

索引：`(userId, status)`、`(projectId, status, createdAt)`、`(status, createdAt)`。

#### 2. 后端流水

- **`POST /api/canvas/images`** 不再调 provider，只做：参数校验 + 项目所有权 + 配额检查（**含 in-flight 任务计数**，避免狂提交）+ 模型能力预检 → 写一行 `CanvasImageTask`(PENDING) → 返回 `{ taskId, status }`（HTTP 202）
- **`GET /api/canvas/images/tasks/:id`** 单任务查询，终态映射成与旧同步接口一致的 `{ images: [...], revisedPrompt }`
- **`GET /api/canvas/images/tasks?projectId=...&status=active`** 列出当前项目在途任务（孤儿恢复用）
- **`web/src/lib/canvas/image-task-runner.ts`**：`runImageTask(taskId)` 用条件 `updateMany(where:{status:'PENDING'})` 抢占，覆盖 provider 调用（10min 单次 fetch 超时）+ 落盘 + `CanvasAsset` / `CanvasAiCall` / `UserActionLog` 三连写

#### 3. Worker

- 新增 `web/src/worker/pollCanvasImageTasks.ts`：3 秒 tick，并发 2 个 PENDING 任务（`WORKER_CANVAS_IMAGE_BATCH` / `WORKER_CANVAS_IMAGE_POLL_INTERVAL` 可调）
- 启动时 `reclaimZombies()` 把超过阈值（默认 20 分钟）还在 RUNNING 的任务标记 FAILED，避免崩溃后僵尸态
- 主循环改为视频任务 + 画布图任务两个独立 loop（视频 15s 节奏不变，画布图 3s 紧节奏）

#### 4. 画布前端

- `MMFC-canvas/src/api/image.js`：拆出 `submitImageTask` / `pollImageTask` / `listImageTasks`；旧 `generateImage` 现在是 submit + poll 的语法糖
- `useImageGeneration().generate(params, options)`：新增 `onTaskCreated` / `onProgress` / `signal` 回调；暴露 `taskId` ref
- `ImageConfigNode`：拿到 taskId 立刻写到输出 `ImageNode.data.activeTaskId`
- `ImageNode`：mount/watch `activeTaskId`，自动恢复轮询，卸载时 abort

#### 5. 浏览器关 tab / 刷新 / 断网怎么办

`activeTaskId` 持久化在 `CanvasNode.data` 里（随项目存盘）。重新打开画布时 `ImageNode` mount 检查到 `activeTaskId && !url` 就自动续轮询。Worker 跑完写回数据库，前端拿到结果就刷新。完全无感。

#### 6. 数据库迁移

```bash
cd web && npx prisma migrate deploy   # 新增 CanvasImageTask 表
```

迁移文件：`20260508000000_canvas_image_task`。

---

### 版本 1.3.0 更新摘要

**主要特性：方案 B — 凭据与用途解耦（多账号 + 模型自由切换）**

1.2.0 的"每用途绑死一个 provider"被替换为：**ProviderCredential 共享凭据池 + ModelRegistry 决定 provider 偏好**。同一用途下不同模型可走不同 provider，同 provider 也支持多账号（生产 / 测试 / 多区域）。

#### 1. 数据模型

- 新表 **`ProviderCredential`**（id / provider / name / baseUrl / apiKey 加密 / deployment / apiVersion / isPrimary / isActive / sortOrder / remark）。同 provider 类型只允许一条 `isPrimary=true`
- **`UserApiConfig`** 新增 `credentialId` 可选外键。设置后运行时优先用共享凭据的最新值（实现 key rotation 一处生效）
- **`GlobalConfig`** 新增 4 个 `${purpose}_default_model_key` 键，替代旧的 `${purpose}_provider/api_key/...`（旧 keys 仍保留作兜底）

#### 2. 凭据解析逻辑（`web/src/lib/llm/credential-resolver.ts`）

```
resolveByModel(purpose, modelKey, opts)：
  1. UserApiConfig override（按 callType + isDefault）
  2. ModelRegistry 查 model.providers 集合
  3. 显式 preferredCredentialId（必须 ∈ supportedProviders）
  4. 按 model.providers 顺序找 isPrimary=true 凭据
  5. 任意 isActive 凭据
  6. 回退到 v1.2.0 GlobalConfig.${purpose}_* 路径
```

请求体新增可选 `credentialId` 字段，画布前端的"齿轮选凭据"UI 通过此字段显式覆盖默认。

#### 3. Admin 后台重构

| 旧（1.2.0） | 新（1.3.0） |
|---|---|
| `/system/providers`（4 用途独立配 provider） | `/system/credentials`（凭据 CRUD + 测试 + 设主用） |
|  | `/system/defaults`（4 用途默认模型 + 实时凭据预解析） |
| `/system/model-registry` | `/system/model-registry`（不变） |

旧 `/system/providers` 降级为跳转提示页。Admin Server 新增 `credentialsRoutes`，全部带审计日志。

#### 4. 画布前端

- `/api/canvas/config` 响应增加 `credentials`（无 apiKey）+ `defaults` 字段
- `models` Pinia store 新增 `serverCredentials` / `serverDefaults` / `getCredentialsForModel(modelKey)`
- 服务端初始化后**不再按 `currentProvider` 过滤模型下拉**——所有 isActive 模型都可见，凭据按 `model.providers` 顺序自动匹配

#### 5. 数据库迁移

```bash
cd web && npx prisma migrate deploy
cd admin && npx ts-node prisma/seed.ts   # 自动从旧 GlobalConfig 回填 ProviderCredential
```

迁移文件：`20260507000000_provider_credential`。

#### 6. Bug 修复

- "模型注册表新增模型，sizes/qualities 不显示在画布前端"——根因在 `MMFC-canvas/src/stores/models.js` 的 helper 只查硬编码 `IMAGE_MODELS`，不走 server hook。已切到 Pinia store 优先

---

### 版本 1.2.0 更新摘要（归档）

**主要特性：多 Provider LLM 即插即拔支持**——画布聊天、文生图、图生图、分镜生成四条链路从"固定 Gemini"改造为多 provider 按用途独立配置。已被 1.3.0 的方案 B 替代（凭据与用途解耦），但 LLM 抽象层（`web/src/lib/llm/`，含 `chat.ts` / `image.ts` / `capabilities.ts`）仍是当前架构的核心。

主要变更：
- 新增 `web/src/lib/llm/` 抽象层（types / config-resolver / chat / image / capabilities）
- 支持 `google` / `openai` / `azure_openai` / `custom` 四类 provider
- 新增 `ModelRegistry` 表（admin 注册并启用/禁用模型，画布前端实时生效）
- `PromptTemplate` 加 `applicableProviders` 字段 + Schema 实测功能
- `UserApiConfig` 加 `callType / deployment / apiVersion` 字段
- 3 条 migration：`20260429000000` / `20260429010000` / `20260429020000`

---

### 版本 1.1.2 更新摘要（归档）

相对 **1.1.1** 的主要变更（**MMFC Studio Canvas** 为主）：

- **性能与内存**：画布 `canvas` store 用 `mutationVersion` 触发自动保存，替代对 `nodes` / `edges` 的 deep watch；撤销历史在入栈前剥离 `base64`、`maskData` 等重字段，并增加约 30MB 的软字节上限与 FIFO 裁剪，降低大图编辑时的内存峰值与卡顿。
- **参考图上传**：图片节点本地上传优先走 `uploadAsset`，节点内保存 HTTP `url`（及 `assetId` 等），避免整图 data URL 长期驻留在快照与请求体中；单文件约 12MB 上限，**413** 明确提示压缩重试。
- **LLM / 文本节点**：`LLMConfigNode`、`TextNode` 的流式对话与「润色」改为直接调用 `streamChatCompletions`，与项目上下文、模型适配逻辑对齐。
- **Vue Flow 节点**：`ImageConfigNode`、`VideoConfigNode` 将 deep watch 收窄为监听影响尺寸与 handle 的字段，减少全图 `updateNodeInternals` 连锁触发。
- **视频节点**：本地上传替换前 `URL.revokeObjectURL` 释放旧 blob，避免 blob URL 与文件字节累积。
- **体验与可观测**：新增 `MessageBridge` 将 Naive UI `useMessage` 挂到 `window.$message`；开发环境可选 `memDebug` 周期性输出堆占用（生产为 no-op）。

---

## 环境要求

- **Docker** 与 **Docker Compose**（推荐 v2）
- 可选本地开发：**Node.js ≥ 18**、**pnpm / npm**（各子项目 `package.json`）

## 一键启动（Docker）

在仓库**根目录**：

```bash
cp .env.docker.example .env
# 编辑 .env：至少填写 DB_PASSWORD、NEXTAUTH_SECRET、ENCRYPTION_KEY
docker compose up -d --build
```

默认端口（可在 `.env` 中调整）：

| 服务 | 地址 |
|------|------|
| 用户端 | http://localhost:3000 |
| 管理后台 Web | http://localhost:8080 |

首次启动会由 `db-init` 执行 `prisma db push` 与种子数据（含默认 ModelRegistry 条目）。

## 代码优化项（基于当前代码扫描）

1. `admin/web/src/api/*.js` 与 `*.ts`、`admin/web/src/router/index.js` 与 `index.ts` 同时存在，当前存在双份前端 API/路由实现，建议收敛为单一 TypeScript 源，避免接口变更漏改。
2. `admin/server/src/modules/credentials/credentials.routes.ts`、`connection-test.routes.ts` 与 `web/src/lib/llm/config-resolver.ts` 中有重复的 `normalizeBase` / probe 逻辑，建议抽成共享模块，降低多处修补的风险。
3. `web/src/lib/llm/credential-resolver.ts` 当前按 provider 顺序多次查询数据库，模型和凭据规模继续增长后会放大查询次数，建议改为单批拉取候选凭据后在内存中过滤排序。
4. `web/src/lib/prompt-loader.ts` 目前主要依赖 5 分钟 TTL 缓存，后台发布 / 回滚后前台存在短暂延迟，建议补显式失效机制。
5. `MMFC-canvas/src/views/Canvas.vue` 仍有项目复制 / 删除相关 `TODO`，说明画布项目操作闭环还不完整，建议补齐并加端到端验证。
6. 根仓库仍有 `tmp/`、`.claude/` 等本地工作痕迹未纳入忽略规则；本次未自动入库，但建议后续明确 `.gitignore` 策略，避免日志和草稿误提交。

### 升级已有部署（1.1.x / 1.2.0 / 1.3.0 / 1.4.0 / 1.5.0 / 1.5.1 → 1.5.2）

1. 拉取最新代码
2. 执行数据库迁移（在 `web/` 目录）：
   ```bash
   npx prisma migrate deploy
   ```
   依次会跑：
   - `20260429*`（1.2.0：UserApiConfig 用途化、PromptTemplate applicableProviders、ModelRegistry）
   - `20260507000000_provider_credential`（1.3.0：ProviderCredential 表 + UserApiConfig.credentialId）
   - `20260508000000_canvas_image_task`（1.4.0：CanvasImageTask 异步任务表）
   - `20260509060000_provider_credential_scopes`（1.5.0：ProviderCredential 的用途 / 模型作用域）
   - `20260510000000_storyboard_seed`（1.5.2：Storyboard.seed，可按分镜覆盖项目 seed）
   - `20260510001000_canvas_ai_call_cost`（1.5.2：CanvasAiCall.costEstimate）
3. 执行 seed 补充初始数据（首次升级需要）：
   ```bash
   cd admin && npx ts-node prisma/seed.ts
   ```
   - 写默认 ModelRegistry 条目（仅缺失时）
   - 1.3.0：把 `${purpose}_*` 老 GlobalConfig 自动回填进 ProviderCredential（仅当表为空时）
4. 重启所有容器：
   ```bash
   docker compose up -d --build
   ```
   `web-worker` 启动时会调 `reclaimZombies()` 清理上一轮残留的 RUNNING 任务。
5. 进入管理后台核对：
   - **系统设置 → 凭据池**：检查自动迁移的凭据，按需补全 deployment / apiVersion 等 Azure 字段
   - 为高风险共享 key 配置 `purposes` / `modelKeys`，避免聊天、分镜、画布生图误共用
   - **系统设置 → 默认模型**：为 4 个用途各选一个默认模型
   - **系统设置 → 模型注册表**：按需启用/禁用模型
   - **Prompt 管理**：确认 provider-specific 模板与 Schema 已发布

### GCS（可选）

若不使用 GCS，请勿将真实服务账号 JSON 提交仓库；从 [`docker-compose.yml`](docker-compose.yml) 中移除 `web-app` / `web-worker` 上绑定 `gcs-credentials` 的 bind mount 行，并在 `.env` 中不配 `GCS_*`，否则容器可能因宿主机缺少文件而启动失败。

## 本地开发（概要）

各子项目可单独安装依赖并运行；数据库需与本机或 Docker 中的 Postgres 一致。管理端本地流程可参考 [admin/README.md](admin/README.md)；用户端可参考 [web/README.md](web/README.md)。

## 安全与配置

- **切勿**将 `.env`、服务账号 JSON、`*.pem` 等密钥提交到 Git。仓库已通过 `.gitignore` 忽略常见敏感路径；复制 `.env*.example` 后本地填写。
- 生产环境务必修改默认密钥类变量（如 `NEXTAUTH_SECRET`、`ADMIN_JWT_SECRET`、`DB_PASSWORD`）。
- v1.2.0 起 API Key 通过数据库 GlobalConfig 加密存储（AES，`ENCRYPTION_KEY` 环境变量），不再依赖 `.env` 中的 `GEMINI_API_KEY` 等硬编码变量；旧变量在 GlobalConfig 为空时仍可作回退兜底。

## 许可证

若各子目录另有 LICENSE，以子目录为准；未特别声明时以本仓库根目录策略为准。
