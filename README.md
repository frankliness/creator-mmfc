# Creator MMFC

**版本：2.0.0**

面向分镜与视频创作的一体化平台：用户端（Next.js）、异步 Worker、管理后台（Fastify + Vue），并集成 **MMFC Studio Canvas**（Vue Flow 可视化 AI 画布）。数据层使用 **PostgreSQL**，对象存储**新链路走阿里云 OSS**（v2.0.0 起，旧链路 GCS 保留只读），并集成 **BytePlus Asset Library** 供 Seedance 视频生成引用资产。

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

- 邮箱验证码注册（发送验证码 → 填码 → 创建账号）
- 忘记密码：邮箱 + 验证码 + 新密码（`/forgot-password`）
- 登录态修改密码：旧密码 + 新密码（`/account`）
- 邮箱密码登录（NextAuth + Credentials）
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
- 凭据池管理：CRUD、连通性探测、主用凭据、用途/模型粒度适用范围、**按 (渠道, 模型) 独立并发上限**
- 默认模型管理、模型注册表、用户行为日志、审计日志、Token 统计
- **v1.9.0：Series 管理（5 Tab 详情：概览 / 成员 / 预算 / 集数 / 日志）+ Series 创建表单 + 预算调整**
- **v2.0.0：Series 详情页"素材组"Tab — 绑定 / 创建 / 重试 / 改绑 / 解绑 BytePlus Asset Group**

### v2.0.0 新增：Series 素材库 + 阿里云 OSS + BytePlus 闭环

**整体目标**：取消旧版本里"用户在分镜里手填 `asset_uri`"的所有路径，建立 Series 级统一素材库。

- **Series 素材库页面**（`/series/[id]/assets`）：上传图片/视频/音频 → metadata probe → 阿里云 OSS → SeriesAsset 入库 → 异步同步 BytePlus，3 秒轮询同步状态
- **资产命名规则**：同 Series 全类型唯一，最大 64 字符，DB 展示名保留中文，OSS object key 用 UUID 安全化
- **分镜资产 picker modal**（替代旧的 asset_uri 手填）：FIRST_FRAME / MULTIMODAL 两种模式互斥，模式内分槽位选择 SYNCED 状态的资产；首帧资产名自动填入分镜 displayName
- **分镜提交校验链**：Series 必须绑定有效 Asset Group、所有引用资产必须 SYNCED 且属于当前 Group、模式合法、参考图≤9 张 / 参考视频≤3 个总时长≤15s
- **Seedance content[] 协议**：全部走 `asset://<byteplusAssetId>`，提交时由后端 resolver 现场生成
- **Worker 自动资产化**：Seedance 视频生成成功后，Worker 自动下载视频 + 尾帧（API URL 优先，缺失时 ffmpeg 抽末帧）→ 上 OSS → 创建 SeriesAsset(VIDEO_RESULT / VIDEO_TAIL_FRAME) → 同步 BytePlus
- **Canvas → 素材库同步**：Canvas 节点新增"同步到素材库"按钮 + 命名 modal，复制图片二进制到 OSS 创建 SeriesAsset(CANVAS_GENERATED)
- **Admin Asset Group 管理**：创建 Series 时可选绑定已有 / 新建 BytePlus Group；创建失败 Series 仍创建成功，Group 落 FAILED 状态可重试

### v1.9.0 新增：Series 项目空间

- 用户端 `/series` 路由层级，三角色 RBAC（OWNER 导演 / PRODUCER 制作者 / VIEWER 只读）
- 按 Series 设定 Seedance token 预算池 + Canvas 成功调用次数硬上限
- OWNER buffer 调配（buffer ↔ 集数双向）、集数锁定 / 解锁
- 新建画布弹窗可绑定 Series；画布生图调用从 Series 预算池扣减
- 画布快照乐观锁互踢提示、画布文字节点拖拽缩放

---

### 版本 2.0.0 更新摘要

**主要特性：Series 素材库 + 阿里云 OSS + BytePlus Asset Library 闭环**

本版本聚焦"资产链路统一"。在 v1.9.0 的 Series 项目空间基础上，引入 Series 级统一素材库；阿里云 OSS 作为长期对象存储（与旧 GCS 链路并存）；首次接入 BytePlus Asset Library 给 Seedance 视频生成提供 `asset://` 引用协议；分镜提交全面取消手填 `asset_uri / assetsJson`。

#### 1. 数据模型（双 schema）

新增：

- `SeriesAssetGroup`：Series ↔ BytePlus Asset Group 1:1 软绑定。`status`：`ACTIVE` / `FAILED`（创建失败时仍保留记录，可重试）/ `UNBOUND`（手动解绑）
- `SeriesAsset`：统一资产。`source` 4 种：`MANUAL_UPLOAD` / `CANVAS_GENERATED` / `VIDEO_RESULT` / `VIDEO_TAIL_FRAME`。`byteplusSyncStatus` 5 种：`NOT_SYNCED` / `SYNCING` / `PROCESSING` / `SYNCED` / `FAILED`。`(seriesId, normalizedName)` 唯一约束保证同 Series 全类型不重名。

修改：

- `Storyboard.generationMode`（FIRST_FRAME / MULTIMODAL；为空视为 legacy 老数据）+ `Storyboard.assetRefs`（结构化 JSON 引用）。老的 `assetBindings` / `seedanceContentItems` 字段保留只读不再写入。
- `Storyboard.displayName`（与 v1.10.0 inline rename 互通）—— picker 选首帧资产时自动填充该字段。
- `GenerationTask`：加 `ossVideoKey / ossVideoUrl / lastFrameUrl / lastFrameAssetId / videoAssetId` 五个字段，Worker 持久化时回填。

迁移：`20260520000000_v2_0_0_series_asset_library`，跟在 v1.10.0 的 `20260518000000_storyboard_display_name` 之后。

#### 2. 资产命名与 OSS 路径规则

- 用户展示名 `SeriesAsset.name`：保留原始输入，**允许中文**，最大 64 字符
- `normalizedName`：`trim → 小写化 → 多空白折叠为单空格`，用于唯一性判重
- 非法字符：`/ \ ? # % & =` 与换行、制表符
- OSS object key 安全化（**永不含中文**）：
  - 手动上传 / Canvas：`series/{seriesId}/assets/{assetId}.{ext}`
  - 视频：`series/{seriesId}/episodes/EP{n}/{storyboardId}_video.mp4`
  - 尾帧：`series/{seriesId}/episodes/EP{n}/{storyboardId}_tail.png`
- BytePlus `AssetName` 用展示名（支持中文模糊搜索）

#### 3. 用户端

- 新路由 `/series/[seriesId]/assets`：上传 + 类型/来源/同步状态筛选 + 缩略图预览 + 单卡同步/重试操作；前端 3 秒轮询 SYNCING 状态的资产
- 上传链路：metadata probe（sharp / fluent-ffmpeg）→ 阿里云 OSS PUT → 写 SeriesAsset → 异步触发 BytePlus CreateAsset
- 分镜资产 picker modal（`asset-picker-modal.tsx`）：
  - 顶部 displayName 输入（最大 80 字符，picker 选首帧资产时自动填入资产名）
  - 模式 toggle：FIRST_FRAME / MULTIMODAL 互斥，切换时清空对方字段
  - FIRST_FRAME：首帧必填、尾帧可选
  - MULTIMODAL：参考图 1-9 张 / 参考视频 0-3 个 / 参考音频 0-1 个，不能只有音频
  - 资产选择器只显示当前 Series Group 下 SYNCED 资产
- 分镜提交 `/api/storyboards/[id]/submit`：
  - 新链路 `generationMode + assetRefs` 优先，由 `storyboard-asset-resolver.ts` 校验 Series 绑 Group + 资产 SYNCED + 模式互斥 + 模型能力 + 数量约束，并输出 Seedance content[]（全 `asset://<byteplusAssetId>`）
  - Legacy（老分镜无 `assetRefs`）保留 `seedanceContentItems` 透传
  - Seedance 调用加 `return_last_frame: true`
- Canvas 节点新增"同步到素材库"按钮 + 命名 modal（`from-canvas` 端点）

#### 4. Worker

- `video-persist.ts`：在原 GCS 链路之外新增 OSS 持久化分支
  - 视频结果 → OSS + 创建 SeriesAsset(VIDEO_RESULT) + 异步同步 BytePlus → 回填 `GenerationTask.videoAssetId/ossVideoUrl`
  - 尾帧：Seedance API 返回 URL 时优先下载，缺失时用 `@ffmpeg-installer/ffmpeg` 抽 mp4 末帧（不依赖系统 ffmpeg），处理同视频
- `seedance.ts` `getTaskStatus` 透传 `raw` JSON，便于 Worker 兼容解析尾帧字段：`content.last_frame_url ?? content.last_frame?.url ?? content.image_url ?? content.images?.[-1]?.url`

#### 5. Admin 后台

- 创建 Series 时可选 BytePlus Group 配置：
  - "绑定已有"：搜索 BytePlus 账号下的现成 Group
  - "创建新 Group"：调 BytePlus CreateAssetGroup，失败时 Series 仍创建成功，Group 落 `status=FAILED` 可重试
- Series 详情页加"素材组"Tab：状态展示 + 重试 / 改绑 / 解绑按钮
- API：`POST/GET/DELETE /api/admin/series/:id/asset-group` + `GET /api/admin/series/byteplus/asset-groups`

#### 6. BytePlus Asset Library 真实协议

经真实账号端到端验证：

- Endpoint：`https://open.byteplusapi.com/`
- 认证：Volcengine 标准 V4 HMAC-SHA256 签名（service=`ark`, region=`ap-southeast-1`, version=`2024-01-01`）
- 协议：POST + JSON body + `?Action=X&Version=2024-01-01` query
- 5 个 action：`CreateAssetGroup` / `GetAssetGroup` / `ListAssetGroups`（Filter.GroupType 必填）/ `CreateAsset`（URL 大写字段名 + AssetType 必填）/ `GetAsset`
- 图片限制：宽 300-6000px
- OSS bucket 私读时**必须用预签名 URL**给 BytePlus，TTL ≥ 1h；公读 bucket 也可直接传公网 URL

环境变量改名：
- `BYTEPLUS_API_KEY` → `BYTEPLUS_ACCESS_KEY` + `BYTEPLUS_SECRET_KEY`
- 新增 `BYTEPLUS_REGION` / `BYTEPLUS_ENDPOINT` / `BYTEPLUS_PROJECT_NAME`
- 新增阿里云 OSS：`ALIYUN_OSS_REGION / BUCKET / ACCESS_KEY_ID / ACCESS_KEY_SECRET / ENDPOINT / PUBLIC_HOST`

#### 7. 1.10.x 兼容性

本版本从 v1.9.1 基线开发，已主动合入 v1.10.0–v1.10.3 全部改动：

- v1.10.0：Storyboard.displayName（与 picker 联动）/ Series owner 同步事务化 / 更换导演 UI / formatEpisodeTitle helper / session-guard 单设备登录 / 账户改名 / Canvas owner 同步
- v1.10.1：Admin Token Usage 报告
- v1.10.2：Canvas stats 修复
- v1.10.3：版本号

#### 8. 新依赖

- `ali-oss` ^6.23.0 + `@types/ali-oss`
- `sharp` ^0.34.0（图片 metadata probe）
- `fluent-ffmpeg` ^2.1.3 + `@types/fluent-ffmpeg`
- `@ffmpeg-installer/ffmpeg` ^1.1.0 + `@ffprobe-installer/ffprobe` ^2.1.2（跨平台 bundle 二进制，**不依赖系统 ffmpeg**）

`next.config.ts` 新增 `serverExternalPackages`：把 ali-oss / sharp / fluent-ffmpeg / @ffmpeg-installer / @ffprobe-installer 标为 server-external，避免 Next 16 Turbopack 误把动态 require 和 README 当模块解析。

#### 9. 端到端验证

用户真实 BytePlus + 阿里云 OSS 凭据完整跑通：

1. ✅ OSS PUT/HEAD/signed URL
2. ✅ BytePlus CreateAssetGroup
3. ✅ BytePlus GetAssetGroup / ListAssetGroups (keyword filter)
4. ✅ BytePlus CreateAsset with OSS signed URL
5. ✅ BytePlus GetAsset poll → Active (2 轮内)
6. ✅ 测试 group 清理（DeleteAssetGroup action 验证可用）

详细见 PR 描述。

#### 10. 数据库迁移

```bash
# 拉取最新 schema 后
cd web && npx prisma db push   # 或 npx prisma migrate deploy
cd admin/server && npm run db:generate
```

新表 `SeriesAssetGroup`、`SeriesAsset`；老的 Storyboard `assetBindings/seedanceContentItems` 字段保留只读，新提交自动写入 `generationMode + assetRefs`。

#### 11. 升级注意

- **环境变量必须配齐**：`ALIYUN_OSS_ACCESS_KEY_ID / ALIYUN_OSS_ACCESS_KEY_SECRET / ALIYUN_OSS_REGION / ALIYUN_OSS_BUCKET` + `BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY`，否则资产上传 / 同步会报错
- **OSS bucket**：推荐保持私读（更安全），代码会用预签名 URL 给 BytePlus；公读也可
- **管理员行动**：创建 Series 时必须绑定或新建 BytePlus Group，否则用户上传素材只能落 OSS 不能同步、分镜也无法提交 Seedance
- **老分镜兼容**：v1.9.0/1.10.x 创建的分镜（含 `seedanceContentItems` 字符串数组）继续可提交，但新创建分镜强制走 picker

---

### 版本 1.10.3 更新摘要

**主要特性：历史归档画布与工作台入口解耦**

#### 1. 历史归档迁移脚本

- 新增 `admin/scripts/archive-legacy-projects-readonly-budget.sql`
- 用于把 legacy `Project` / `CanvasProject` 归档到单个 Series，并创建 0 预算：
  - `seedance / * / video_generation / TOKEN = 0`
  - `canvas / * / canvas_image_generation / SUCCESS_COUNT = 0`
- 目标是阻止历史项目继续产生新的 Seedance / Canvas 生图消耗

#### 2. 归档 Series 保留历史项目名称

- `/series/[seriesId]` 页面对未设置 `episodeNumber / episodeTitle` 的归档 legacy 项目，改为直接显示原始 `Project.name`
- 正常 Series 集数仍保持 `第 N 集 · 标题` 的展示方式

#### 3. Canvas 两个入口分离

- `/ai-canvas` 首页：只显示 legacy 个人画布和 `ACTIVE` Series 下的画布，隐藏归档 Series 的历史画布
- `/series/[seriesId]` 页面内的 Canvas 区块：显式按 `seriesId` 拉取该 Series 下的画布，归档 Series 也能查看历史画布

---

### 版本 1.10.2 更新摘要

**主要特性：Canvas Token 统计补漏 + 画布命名查重**

#### 1. Admin Token 统计补齐 Series Canvas 消耗

- 「按项目维度」tab 的 ①「按 Series 汇总」和 ②「集数/画布 × 用户明细」兼容两类 Canvas token 行：
  - 新口径：`TokenUsageLog.canvasProjectId = CanvasProject.id`
  - 旧口径：`TokenUsageLog.projectId = CanvasProject.id`
- Series 归属使用 `COALESCE(TokenUsageLog.seriesId, CanvasProject.seriesId)`，避免旧 Canvas token 行因缺 `seriesId` 被漏统
- ② 明细把 Canvas 显示为 `画布 · 名称 · 短ID`，同名画布可区分；同一画布同一用户同一模型合并展示，不再按 `canvas_image` / `canvas_image_edit` 拆行
- 「按项目维度」CSV 导出同步使用同一口径

#### 2. Canvas Token 写入字段归正

- Canvas 成功调用写入 `TokenUsageLog` 时，画布 ID 写入 `canvasProjectId`，图片任务 ID 写入 `canvasImageTaskId`
- `projectId` 保留给集数 `Project.id`，避免后续报表把 CanvasProject 当 Episode join
- 写入侧继续透传 `seriesId` 与真实上游 provider；历史 `provider=gemini-canvas` 行不自动改写，仍可按 `metadata.upstreamProvider` 追溯

#### 3. 历史数据回填

- 已对可明确归属的历史 Canvas token 行回填 `seriesId`：`TokenUsageLog.projectId = CanvasProject.id AND CanvasProject.seriesId IS NOT NULL`
- legacy / 未绑定 Series 的历史画布不自动归入 Series，避免错误归属

#### 4. 画布命名查重

- 新建画布和重命名 / 改归属时均做服务端查重
- Series 画布：同一 `seriesId` 下非 `DELETED` 画布不允许重名
- legacy 个人画布：同一用户、`seriesId IS NULL` 下非 `DELETED` 画布不允许重名
- 名称入库前会 `trim`，历史已有重名不自动处理

---

### 版本 1.10.1 更新摘要

**主要特性：Admin Token 统计页"按项目维度"重做 + 报表口径统一**

#### 1. 「按项目维度」tab 增强

- ①「按 Series 汇总」新增「模型分布」列：单行展示该 Series 下每个 `provider/model` 的 token 与调用次数
- ②「集数 × 用户 明细」新增「模型」列，行键从 `(series, project, user, provider)` 细化到 `(... , provider, model)`，看得到具体在用哪个模型
- ③「全项目（含 legacy）Top 100」补齐「Provider」+「模型」列
- 新增「导出」按钮：按当前 Series / 日期筛选导出 ① + ② 拼接的单 CSV（UTF-8 BOM、两段标题分隔）

#### 2. 报表口径统一过滤（全站 + 按项目维度）

- 新增 `finalizedFilter()` 工具函数，应用到 `/summary` `/by-user` `/by-provider` `/by-project` `/by-series` `/by-series-breakdown` `/export/*` `/detail` 全部受影响查询
- 过滤规则：`status='FINALIZED'` AND `(metricType IS NULL OR metricType='TOKEN')`
- 效果：排除 seedance `RESERVED`（进行中）/ `RELEASED`（失败放走）的占位行；排除 canvas `SUCCESS_COUNT` 这类"次数"配额标记行；只统计真实 token 消耗

#### 3. Canvas TokenUsageLog provider 归因到真实上游

- 改 `web/src/lib/canvas/canvas-logger.ts` 写入 `TokenUsageLog` 时 `provider` 字段直接记真实上游（`azure_openai` / `openai` / `google`），不再硬编码为 `gemini-canvas`
- 同步修 `admin/.../canvas-projects.routes.ts` 删除 canvas project 时清理 TokenUsageLog 的 WHERE 条件，从 `provider="gemini-canvas"` 改为 `requestType IN ('canvas_chat', 'canvas_image', 'canvas_image_edit')`
- `CanvasAiCall` 表 provider 仍保留 `gemini-canvas`（画布通道审计语义，不变）
- 历史数据需跑一次性回填 SQL：`UPDATE "TokenUsageLog" SET provider = metadata->>'upstreamProvider' WHERE provider = 'gemini-canvas' AND metadata->>'upstreamProvider' IS NOT NULL`

#### 4. Canvas 写入侧补 `seriesId`

- `canvas-logger.ts` / `token-logger.ts` 加 `seriesId` 字段；`canvas/chat/route.ts` 与 `image-task-runner.ts` 调用 `logCanvasCall` 时透传 `project.seriesId`
- 修复"按项目维度"报表里 canvas 真实 token 行（旧 `gemini-canvas` provider）缺 seriesId 无法聚合的问题
- 老数据需一次性回填：`UPDATE "TokenUsageLog" t SET seriesId = cp."seriesId" FROM "CanvasProject" cp WHERE t."projectId" = cp.id AND t.provider IN (...) AND t."seriesId" IS NULL`

#### 5. 数据库无 schema 变更

仅两条一次性回填 SQL，**TokenUsageLog 表结构不变**。

---

### 版本 1.9.0 更新摘要

**主要特性：Series（系列）+ 资源预算池 + 数据保护增强**

#### 1. 业务体系：Series / Episode / 三角色

- 不重命名旧 Project；新增 `Series`（产品语义"项目"），把 `Project` 重定义为"集数（Episode）"
- 三角色 RBAC：OWNER（导演）/ PRODUCER（制作者）/ VIEWER（只读）；后端每次请求实时查 `ProjectMember`，不缓存
- 新模型：`Series`、`ProjectMember`、`SeriesResourceBudget`、`ProjectResourceAllocation`、`BudgetEvent`
- 字段扩展：`Project.seriesId / episodeNumber / episodeTitle / lockedReason`、`CanvasProject.seriesId`、`User.canSelfCreateProject`
- 兼容：legacy Project（`seriesId = null`）保留作者自建路径，不进入预算池

#### 2. 资源预算池

- **Seedance**：按 token 预扣 → 提交 → 释放，事务 + `idempotencyKey` 防重；估算公式集成 `minimumTokenLimits` 强制下限
- **Canvas**：成功调用次数硬上限——`committedUsage` 达 `totalBudget` 立即 429，允许 in-flight 任务跑完
- OWNER buffer 调配：buffer ↔ 集数双向，全程写 `BudgetEvent` 审计
- 新增 lib：`series-budget.ts` / `seedance-pricing.ts` / `series-membership.ts` / `workspace-guards.ts`

#### 3. Admin 后台

- `/series` 列表 + 创建表单（基础信息 / 集数 / 成员 / Seedance 预算 / Canvas 预算 / buffer 比例，单事务提交）
- `/series/:id` 五 Tab 详情：概览 / 成员 / 预算 / 集数 / 日志（BudgetEvent 分页）
- 系列默认风格 / 画幅 / 分辨率 / seed 全局配置（强制集数提交沿用）

#### 4. 用户工作台

- `/series` 路由层级 + nav 入口；`/dashboard` 标题改为"我的旧项目"保留 legacy Project
- `/projects/new` 受 `User.canSelfCreateProject` + `GlobalConfig.allow_user_self_create_project` 双层权限门控
- 客户端组件：`SeriesBudgetCard`（buffer 调配 Dialog）、`SeriesOwnerActions`（锁/解锁 Dialog）、`SeriesCanvasLauncher`、`SeriesSettingsCard`

#### 5. Canvas 集成

- 新建画布弹窗支持选 Series（拉 `/api/workspace/series` 列表，过滤掉 VIEWER 角色）
- `CanvasProject.seriesId` 落库；生图调用从 Series 全局 Canvas 预算池扣减（`committedUsage += 1`）
- **文字节点拖拽缩放**：右下角手柄，宽 / 高存 `node.data`、感知 canvas zoom 因子、随快照持久化

#### 6. 数据保护（P0 安全增强）

- **快照乐观锁**：`CanvasProject` 新增 `version` 字段；客户端 autosave 提交带 `baseVersion`，服务端 `FOR UPDATE` 比对，stale → `409 STALE_BASE_VERSION`
- **异常缩量拦截**：新快照 nodes < 旧 nodes × 50% → `409 SNAPSHOT_SHRINK_DETECTED`（客户端可显式 `confirmShrink: true` 覆盖）
- **快照历史**：`CanvasSnapshotHistory` 保留最近 30 版本，覆写前自动入库；按 `createdAt desc` 截断
- **单会话强制**：`User.activeSessionId`；登录生成新 sid 写入 DB；旧 tab 下次请求 sid 不一致即被踢
- **客户端冲突感知**：`MMFC-canvas` autosave 失败立即停写、模态框引导刷新；指数退避（300ms / 900ms）应对 5xx

#### 7. 并发与限流优化

- `ProviderCredential` 新增 `concurrencyByModel JSON`：按 (渠道, 模型) 独立设并发上限（兼容旧字段 `concurrency` 作 fallback）
- Worker 双层并发：(user, model) + (credential, model)，避免单一模型把渠道打满
- 默认 `globalLimit` 提升到 200（仅作安全上限，真正的限流由 (cred, model) 层把关）
- Admin 凭据编辑表单新增"按模型并发"动态行（Key=modelKey, Value=并发数）

#### 8. 用户体验

- 分镜 seed 字段加"🎲 随机" / "🧹 清空"按钮；Series 上下文锁定提示
- Series 项目锁定风格 / 画幅 / 分辨率 / seed（集数面板不再渲染这些字段，由 Series 默认值统一注入）
- 集数显示修复（不再"第 2 集·第 2 集"重复标题）
- Canvas 文字节点头部"复制 / 删除"按钮保留，新增右下角拖拽角；hover 时手柄高亮

#### 9. Bug 修复

- `/api/videos/[taskId]`：原本只校验 `project.userId === session.user.id`，Series 成员 404；改用 `assertEpisodeAccess(.., 'read')`，OWNER / PRODUCER / VIEWER 均可读
- `db-init` 容器与 `admin-api` 共享镜像（`docker-compose.yml` 加 `image: creator_mmfc-admin-api:latest`），避免 schema drift 导致字段被 `prisma db push --accept-data-loss` 丢弃
- 系列分镜 PATCH / DELETE / clone 路径鉴权统一走 `assertEpisodeAccess`

#### 10. 数据库迁移

- `web/prisma/migrations/20260514000000_v1_9_0_series_budget/`：Series 全套表 + 字段扩展
- `web/prisma/migrations/20260516000000_v1_9_1_series_defaults/`：Series 默认 style / ratio / resolution / seed + activeSessionId + version + snapshot history
- `admin/prisma/migrations/20260514000000_v1_9_0_series_budget/`：admin schema 镜像同步

迁移 SQL 附加：把现有用户 `canSelfCreateProject` 回填 `true`；写入 `GlobalConfig.allow_user_self_create_project = 'false'` 全局开关。

#### 11. 升级注意

- 现有用户保留自建 Project 权限（migration SQL 把 `canSelfCreateProject = true`）
- 新注册用户默认 `false`，需 Admin 把用户加入 Series 才能生产
- 旧 CanvasProject `seriesId = null` 走 legacy 配额，不进入预算池
- 单会话强制启用后：旧浏览器 tab 在新设备登录后会被踢，属于预期行为

---

### 版本 1.8.0 更新摘要

**主要特性：管理后台细粒度权限管理系统**

#### 1. 数据模型扩展

- `AdminUser` 新增 `permissions JSONB?` 与 `deletedAt DateTime?` 字段，支持软删除与权限矩阵存储
- 新增 `@@index([deletedAt])` 索引优化软删过滤性能

#### 2. 权限矩阵体系（14 个分栏 × 2 操作）

14 个管理模块分别为：
- **业务管理**：dashboard、users、projects、canvasProjects、canvasChannelStats、tasks、prompts、tokenUsage
- **日志与审计**：userActionLogs、auditLogs
- **系统配置**：credentials、globalConfig、modelRegistry、defaults

每个分栏支持 `read`（查看）与 `write`（修改）两类操作。SUPER_ADMIN 默认拥有全部权限且不受矩阵限制；ADMIN 与 OPERATOR 可通过权限矩阵进行精细控制。

#### 3. 后端权限守卫

- 新增 `admin/server/src/common/guards/permission.ts`：实现 `requirePermission(section, action)` 与 `requireSuperAdmin()` 守卫
- 每次请求自动查 DB 校验 admin 的 `isActive` 与 `deletedAt` 状态，禁用 / 软删的账号旧 token **立即失效**（不依赖 JWT 过期）
- 14 个业务模块路由逐一迁移为细粒度权限校验（从原有的角色等级制）

#### 4. 管理员管理重构

- **新建管理页面**：[admin-list.vue](admin/web/src/views/system/admin-list.vue) 支持管理员的 CRUD、权限矩阵编辑、禁用 / 软删、重置密码
- **权限矩阵编辑器**：[AdminPermissionMatrix.vue](admin/web/src/components/AdminPermissionMatrix.vue) 提供表格式矩阵编辑 UI，支持联动（write 开启自动 read；read 关闭自动 write 关）、风险指示、批量操作
- **保护机制**：
  - 自我保护：禁止修改自己的角色、禁用自己的账号
  - 最后一个 SUPER_ADMIN 保护：系统必须至少保留一个启用状态的 SUPER_ADMIN，不允许删除 / 禁用 / 降级最后一个

#### 5. 前端权限集成

- **用户 Store 增强**：`admin/web/src/store/user.ts` 新增 `permissions` 字段与 `canRead(section)` / `canWrite(section)` 辅助函数
- **菜单动态过滤**：根据用户权限自动隐藏无权限的菜单项；"系统设置"子菜单全空时整组隐藏
- **路由权限守卫**：`admin/web/src/router/index.ts` 新增 `meta.permission` 标注，访问无权限路由自动跳转 `/403`
- **403 错误页**：新增 `admin/web/src/views/403.vue` 友好提示无权限访问
- **按钮 gating**：业务页面写操作按钮受 `canWrite()` 控制，权限不足时按钮隐藏或禁用

#### 6. 数据库迁移

- 迁移文件：`admin/prisma/migrations/20260513000000_baseline_init/` 与 `20260513000001_admin_permissions_and_soft_delete/`
- 数据回填脚本：`admin/prisma/seeds/backfill-permissions.ts`，按 PRD 模板为现有 ADMIN / OPERATOR 用户回填默认权限矩阵
- 启用 `prisma migrate` 流程：新增 `admin/prisma/MIGRATION_GUIDE.md` 说明基线化步骤

#### 7. 审计日志完善

- admin-mgmt 所有操作均写审计日志，action 分类为 `admin.create` / `admin.update` / `admin.updateRole` / `admin.toggleActive` / `admin.softDelete` / `admin.resetPassword` / `admin.updatePermissions` 等
- 密码字段永不进审计记录（存 `<redacted>` 占位符）

#### 8. Bug 修复

- **Zod v4 验证兼容性**：权限矩阵 schema 改用 `z.record(z.string(), ...)` 替代 `z.enum([...])`，支持前端发送部分权限对象（不强制所有 14 个分栏都提交）
- **401 错误消息传递**：请求拦截器现在正确展示后端返回的错误信息（如"用户名或密码错误"），替代之前的通用"登录已过期"提示

---

### 版本 1.7.1 更新摘要

**主要优化：画布路由与 @ 引用体验增强，修复大图上传拦截后的节点异常状态**

#### 1. 画布项目路由可刷新恢复

- 用户端新增 `/ai-canvas/[projectId]`，项目内刷新不再回到画布首页
- 画布内部切换项目时同步更新外层 URL，且不触发 iframe 重新挂载

#### 2. 图片节点 @ 引用体验优化

- 图片节点改名后，已公开图片会同步更新 `publicProps.name`，避免 @ 列表显示旧名称
- @ 候选项显示名统一优先使用节点 `label`，名称与节点头部保持一致
- @ 选择器图片缩略图放大，并增加悬停大图预览，便于辨认图片内容

#### 3. 修复 >12MB 上传拒绝后的残留状态

- 图片节点主上传与替换上传在超限拒绝后会重置 file input
- 解决"超限一次后再次上传同文件无响应"问题
- 主上传区改为隐藏 input + 按钮触发，解决鼠标悬停仍显示被拦截文件名的问题

---

### 版本 1.7.0 更新摘要

**主要特性：邮箱验证码接入注册、忘记密码与登录态改密**

#### 1. 数据层

| 表 / 字段 | 变更 |
|---|---|
| `User.emailVerified` | 新增 `DateTime?`；新注册流程通过验证码后置为 `now()`，历史用户为 `null` |
| `EmailVerificationCode`（新表） | 存储验证码的 bcrypt 哈希、用途（`REGISTER` / `RESET_PASSWORD`）、过期时间、核销时间、校验次数 |

迁移文件：`web/prisma/migrations/20260512100000_email_verification/migration.sql`

#### 2. 后端 API

| 接口 | 说明 |
|---|---|
| `POST /api/auth/send-code` | 按 `purpose` 发送 6 位验证码；`REGISTER` 时邮箱已注册返 409；`RESET_PASSWORD` 时邮箱不存在悄悄返成功（防账号枚举）；同邮箱 60 秒内限发一次 |
| `POST /api/auth/register` | 改造：必须先发验证码，提交时带 `code` 校验通过才建账 |
| `POST /api/auth/reset-password` | 新增：邮箱 + 验证码 + 新密码（未登录可用） |
| `POST /api/auth/change-password` | 新增：旧密码 + 新密码（需登录态，不发邮件） |

验证码安全设计：bcrypt 哈希存储（明文不落库）、10 分钟 TTL、最多 5 次校验尝试、一次性核销不可复用。

#### 3. 邮件发送

- 新增 `web/src/lib/mailer.ts`：nodemailer SMTP 单例 transport，支持 HTML + 纯文本双版邮件模板
- 新增 `web/src/lib/verification-code.ts`：验证码生成、发送频率控制、核销逻辑
- 环境变量：`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`
- 常见 SMTP：QQ 企业邮箱（`smtp.exmail.qq.com:465`）、阿里云（`smtpdm.aliyun.com:465`）、Gmail（`smtp.gmail.com:587`）

#### 4. 前端页面

| 页面 / 组件 | 变更 |
|---|---|
| `/register` | 新增"发送验证码"按钮 + 验证码输入框 + 60s 倒计时防连击 |
| `/login` | 密码区右上新增"忘记密码？"链接 |
| `/forgot-password` | 新页面：邮箱 + 验证码 + 新密码，重置后跳回登录 |
| `(app)/account` | 新页面（需登录）：旧密码 + 新密码 + 确认密码，改密后强制退出重新登录 |
| 导航栏用户名 | 由纯文本改为链接，点击进入 `/account` |

---

### 版本 1.6.0 更新摘要

**主要特性：画布生图多渠道轮询 + 429 自动冷却**

#### 1. 渠道池调度（多 Azure 部署 / 多 OpenAI Key）

- `ProviderCredential` 新增 `concurrency`（默认 6）和 `cooldownUntil` 字段，支持给每条凭据独立设置并发上限
- Worker 新增渠道池调度路径（`canvas_image_rotation_enabled=true`，默认开启）：
  - 每 tick 按"当前 RUNNING 最少的渠道优先"分发 PENDING 任务（最少负载优先）
  - 原子抢占：`UPDATE ... WHERE status='PENDING' AND bypassRotation=false`，写入 `credentialId + startedAt`
  - 多实例水平扩展时只需把计数挪到 Redis / 改用 `SELECT ... FOR UPDATE SKIP LOCKED`（注释标注扩展点）
- 命中 HTTP 429 / `RateLimitReached` / `Too Many Requests` / `RESOURCE_EXHAUSTED` 等限流错误时：
  - 自动设置 `ProviderCredential.cooldownUntil = now + retryAfterMs`（默认 30s）
  - 任务回退 PENDING（`credentialId` 清空），由下一 tick 的其他渠道接手
  - 最多冷却回退 5 次（超过后直接 FAILED）
- 新增 `web/src/lib/llm/error-classify.ts`：统一识别各 provider 的限流格式并提取 `retry-after`

#### 2. bypassRotation 机制

- 以下任务绕过渠道池，走旧的 global+user 并发路径（`bypassRotation=true`）：
  - 用户级 `UserApiConfig` 配置命中（含 `canvas_image`/`canvas_image_edit` callType）
  - Admin 全局关闭 `canvas_image_rotation_enabled` 开关
  - 请求体显式携带 `credentialId`（admin / 调试场景）

#### 3. CanvasAiCall 新增 `rate_limited` 状态

- `CanvasAiCall.status` 从 `success | failed` 扩为 `success | failed | rate_limited`
- 新增 `CanvasAiCall.credentialId` 字段，便于按渠道聚合
- 配额计算（`canvas-quota.ts`）仍以 `status:"success"` 正向过滤，不受影响

#### 4. Schema 变更

| 表 | 新增字段 |
|---|---|
| `ProviderCredential` | `concurrency INT DEFAULT 6`、`cooldownUntil TIMESTAMP?` |
| `CanvasImageTask` | `failureKind TEXT?`、`bypassRotation BOOLEAN DEFAULT false`、`cooldownRetries INT DEFAULT 0` |
| `CanvasAiCall` | `credentialId TEXT?` |

迁移文件：`web/prisma/migrations/20260512000000_canvas_image_channel_rotation/migration.sql`

#### 5. Admin 配置与看板

- **系统设置 → 凭据池**：列表新增"并发上限"与"冷却到"列；编辑表单新增"并发上限"输入（hint：Azure gpt-image-2 实测约 6）
- **系统设置 → 全局配置**：新增"启用多渠道轮询"开关（关闭后回退到 v1.4 单凭据策略）
- **新页面 → 画布渠道统计**（`/canvas-channel-stats`）：按渠道展示近 1 小时的成功/失败/限流次数与实时 RUNNING 占比，每 30 秒自动刷新

---

### 版本 1.5.3 更新摘要

**主要优化：画布生图并发调度与轮询体验全方位升级**

#### 1. 调度参数全面调优

- 默认全局生图并发由 `2` 提升至 `15`，默认单用户并发由 `5` 收紧到 `3`，默认任务超时由 `10min` 提升到 `30min`，与实际 provider 表现对齐
- 新增 `canvas_image_user_share_cap_pct`（默认 `40`）：单用户最多占用 `globalLimit × pct%` 槽位，防止一人独占全局阻塞其他用户
- 新增 `canvas_image_zombie_grace_ms`（默认 `5min`）：统一控制僵尸回收与 sweeper 的宽限窗口
- 所有参数支持 DB（admin 后台 UI）或 `WORKER_CANVAS_IMAGE_*` 环境变量两路覆盖

#### 2. Worker 健壮性增强

- 启动僵尸回收 cutoff 由 `timeout × 2` 改为 `timeout + grace`，崩溃后恢复时间从最长 2 小时压缩到 35 分钟左右
- 每个 tick 新增 `sweepTimedOutTasks` 兜底，即使 `Promise.race` 漏触发，超时任务也会在 `timeout + grace` 内被释放
- 拣选逻辑加入 `userShareCap` 硬上限，单用户实际占用受 `min(userLimit, shareCap)` 双重约束

#### 3. 前端轮询节奏与体验

- 客户端轮询改为三段指数退避：`<3min → 2s`，`3-10min → 5s`，`>10min → 10s`，长任务下请求量减少约 70%
- 客户端 budget 改为对齐后端 `timeout + grace`，避免"前端先报超时但后端仍在跑"的体验割裂
- ImageNode loading 文案根据 `task.status` 与 `queuePosition` 动态展示"排队中（本人第 X，全平台第 Y）"
- `GET /api/canvas/images/tasks/[id]` 在 PENDING 时返回 `queuePosition: { global, user }`，仅当前用户视角，无隐私泄漏

#### 4. 跨设备/跨 tab 任务恢复

- 画布加载完成后调用 `listImageTasks` 自动把后端仍 PENDING/RUNNING 的任务挂回对应 ImageNode（按 `sourceNodeId` 匹配）
- ImageConfigNode 提交时回传 `sourceNodeId: imageNodeId`，闭环 rehydrate 链路
- 覆盖边缘场景：autosave 还未把 `activeTaskId` 落盘前刷新、A 浏览器提交 B 浏览器打开等

#### 5. Admin 面板补齐

- 系统配置页"画布生图调度"卡片新增"单用户全局占比上限（%）"与"僵尸回收宽限（分钟）"两个输入框，附 tooltip 说明
- 默认 fallback 与后端 `concurrency-config.ts` 保持单一真实来源（15 / 3 / 30min / 40 / 5min）

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
- **`web/src/lib/canvas/image-task-runner.ts`**：`runImageTask(taskId)` 用条件 `updateMany(where:{status:'PENDING'})` 抢占，覆盖 provider 调用（默认 10min，可由 Admin 全局配置）+ 落盘 + `CanvasAsset` / `CanvasAiCall` / `UserActionLog` 三连写

#### 3. Worker

- 新增 `web/src/worker/pollCanvasImageTasks.ts`：3 秒 tick，按 Admin 配置的全局并发和用户并发持续补位启动 PENDING 任务
- 启动时 `reclaimZombies()` 把超过阈值（单任务超时 * 2）还在 RUNNING 的任务标记 FAILED，避免崩溃后僵尸态
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
# 若要开启注册 / 忘记密码邮件，还需填写 SMTP_HOST / SMTP_USER / SMTP_PASS 等
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

### 升级已有部署（任意旧版本 → 1.9.0）

1. 拉取最新代码
2. 在 `.env` / `.env.docker` 中补充 SMTP 配置（注册 / 忘记密码功能必须）：
   ```env
   SMTP_HOST=smtp.exmail.qq.com   # 换成你的 SMTP 服务商
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=no-reply@yourdomain.com
   SMTP_PASS=your-smtp-password
   SMTP_FROM=no-reply@yourdomain.com
   ```
3. 执行数据库迁移（在 `web/` 目录）：
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
   - `20260512000000_canvas_image_channel_rotation`（1.6.0：渠道并发上限、冷却字段、任务渠道绑定）
   - `20260512100000_email_verification`（1.7.0：EmailVerificationCode 表 + User.emailVerified）
   - `20260513000000_baseline_init` / `20260513000001_admin_permissions_and_soft_delete`（1.8.0：admin 权限矩阵）
   - `20260514000000_v1_9_0_series_budget`（1.9.0：Series / ProjectMember / 资源预算池 / BudgetEvent / 字段扩展）
   - `20260516000000_v1_9_1_series_defaults`（1.9.0：Series 默认风格 / 画幅 / 分辨率 / seed、User.activeSessionId、CanvasProject.version、ProviderCredential.concurrencyByModel、CanvasSnapshotHistory）
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
   - **系统设置 → 凭据池**：检查自动迁移的凭据；为用于画布生图的 Azure 凭据设置合适的"并发上限"（Azure gpt-image-2 实测约 6），按需补全 deployment / apiVersion 等 Azure 字段
   - 为高风险共享 key 配置 `purposes` / `modelKeys`，避免聊天、分镜、画布生图误共用
   - **系统设置 → 全局配置**：确认"启用多渠道轮询"开关状态（默认开启；如需兼容旧行为可关闭）
   - **画布渠道统计**：打开 `/canvas-channel-stats` 页面，确认各渠道成功/失败/限流计数正常
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
