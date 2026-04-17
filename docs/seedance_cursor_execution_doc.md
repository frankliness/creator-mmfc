# Seedance 平台项目执行文档

## 1. 目标

构建一个 **Seedance 视频生成平台（团队版）**，开发环境使用 **Cursor**，开发协作机制使用 **agency-agents**。

系统需基于 **BytePlus / ModelArk Dreamina Seedance 2.0 / 2.0 fast 官方异步 API** 实现，支持：

- 邮箱登录与团队成员体系
- 按剧 / 项目划分的素材库
- 素材库成员权限：可读 / 可编辑
- 创作工作台：文生、图生、多模态参考、编辑、续写
- 异步任务创建、轮询、失败重试、历史记录
- 生成成功后自动拉取结果并持久化到对象存储
- Token 计费与管理员额度管理
- 基础审计与安全隔离

---

## 2. 产品约束（必须遵守）

### 2.1 上游 API 主通路

必须走官方 Ark API 主通路，不使用网页自动化作为首期核心依赖。

### 2.2 模型能力差异

#### Seedance 2.0
- 支持文生视频
- 支持图生视频（首帧 / 首尾帧）
- 支持参考图
- 支持参考视频
- 支持图像 / 视频 / 音频组合多模态
- 支持视频编辑
- 支持视频续写
- 输出分辨率仅 480p / 720p
- 时长 4–15 秒或 -1

#### Seedance 2.0 fast
- 支持文生视频
- 支持图生视频（首帧 / 首尾帧）
- 支持参考图
- 不支持参考视频
- 不支持视频编辑
- 不支持视频续写
- 不支持带视频的复杂多模态组合
- 输出分辨率仅 480p / 720p
- 时长 4–12 秒或 -1

### 2.3 模式互斥

以下三类模式不能混用，前后端都必须校验：

1. 图生视频（首帧）
2. 图生视频（首帧 + 尾帧）
3. 多模态参考视频生成

### 2.4 音频约束

不能只输入音频。至少必须包含 1 个参考图像或参考视频。

### 2.5 素材数量与规格约束

- 参考图：1–9 张
- 参考视频：最多 3 个，总时长不超过 15 秒
- 参考音频：最多 3 个，总时长不超过 15 秒
- 图片、视频、音频大小与规格必须在前后端双重校验

### 2.6 结果持久化

Ark 返回的视频链接不是长期稳定资源。生成成功后必须由后台自动：

1. 拉取视频文件
2. 上传到对象存储
3. 在数据库中记录持久化地址
4. 前端历史与下载统一使用持久化资源

---

## 3. 技术方案

### 3.1 技术栈

- 前端：Next.js 15 + TypeScript + App Router
- UI：Tailwind CSS + shadcn/ui
- 表单与校验：React Hook Form + Zod
- 数据请求：TanStack Query
- 后端：Next.js Route Handlers
- 数据库：PostgreSQL
- ORM：Prisma
- 队列：Redis + BullMQ
- 对象存储：GCS / 阿里云 OSS（通过统一抽象层接入）
- 鉴权：Auth.js
- 日志：Pino
- 监控：Sentry + OpenTelemetry

### 3.2 架构原则

必须采用：

- Web App Server
- Background Worker
- Queue
- Storage Adapter
- Ark API Adapter

禁止让前端承担唯一轮询与结果持久化职责。

### 3.3 总体架构

```text
Browser
  -> Next.js App Server
      -> Auth / RBAC
      -> Asset Library Service
      -> Generation Service
      -> Billing Service
      -> Admin Service
      -> Ark Adapter
      -> Storage Adapter
      -> Queue Producer
  -> PostgreSQL
  -> Redis / BullMQ
  -> Worker
      -> Polling Job
      -> Persist Job
      -> Retry Job
  -> GCS / OSS
  -> Sentry / Logs / Metrics
```

---

## 4. 项目目录

```text
apps/
  web/
    app/
    components/
    lib/
packages/
  db/
  core/
  ui/
  auth/
  queue/
  config/
  integrations/
    ark/
    storage/
.cursor/
  rules/
docs/
  architecture/
  runbooks/
```

---

## 5. 领域模型

至少实现以下实体：

- User
- Team
- TeamMember
- Project
- ProjectMember
- AssetLibrary
- LibraryMember
- Asset
- GenerationTask
- GenerationTaskInput
- GenerationTaskOutput
- BillingLedger
- QuotaAccount
- QuotaAllocation
- AdminAuditLog
- JobRun

### 5.1 权限模型

#### 用户级
- 用户拥有个人私有素材库
- 用户只能访问自己拥有或被授权的项目与库

#### 库级
- 可读：允许在生成任务中引用素材
- 可编辑：允许上传、删除、修改、整理素材

所有权限判断必须在服务端强制校验。

---

## 6. 核心服务拆分

### 6.1 GenerationService
负责：
- 接收创作请求
- 校验模型能力与模式合法性
- 构造 Ark `content[]`
- 提交任务到 Ark
- 落库任务记录
- 推送轮询 Job

### 6.2 ArkAdapter
负责：
- createTask
- getTask
- model / endpoint mapping
- API 错误码与异常转换
- 超时与重试策略

### 6.3 AssetLibraryService
负责：
- 项目库 / 个人库管理
- 素材上传与校验
- 权限控制
- 输出 Ark 可用 URL 或资产 ID

### 6.4 PollingWorker
负责：
- 查询上游任务状态
- 更新本地任务状态
- 进入成功 / 失败分支
- 成功后触发 PersistJob

### 6.5 PersistWorker
负责：
- 下载 Ark 临时视频
- 上传对象存储
- 写回持久化地址
- 失败重试、死信与告警

### 6.6 BillingService
负责：
- 创建任务前检查额度
- 任务成功后按 total_tokens 记账
- 保存 completion_tokens 用于对账
- 管理员额度发放 / 扣减

---

## 7. 状态机

平台任务状态建议定义为：

- draft
- queued
- submitting
- submitted
- polling
- succeeded
- failed
- persisting
- persisted
- expired

要求：
- 区分平台状态与上游 Ark 状态
- `succeeded` 不等于已完成持久化
- 只有 `persisted` 才代表结果可长期展示与下载

---

## 8. 前端页面

### 8.1 工作台

三栏布局：

#### 左栏
- 项目切换
- 素材库切换
- 素材列表
- 权限受控操作按钮

#### 中栏
- 模型选择
- 生成模式选择
- Prompt 输入
- 素材选择
- 参数设置：ratio / resolution / duration / generate_audio / watermark

#### 右栏
- 进行中任务
- 最近结果
- 错误提示
- 一键重试

### 8.2 历史页
展示：
- 缩略图
- Prompt 摘要
- 模型
- 分辨率
- 比例
- 实际时长
- Token 消耗
- 创建时间
- 下载
- 基于历史再创建

### 8.3 管理后台
- 成员管理
- 配额发放
- 审计日志
- 项目与素材库权限配置

---

## 9. API 设计

实现以下业务接口：

- `POST /api/projects`
- `GET /api/projects`
- `POST /api/libraries`
- `GET /api/libraries/:id`
- `PATCH /api/libraries/:id/members`
- `POST /api/libraries/:id/assets`
- `GET /api/libraries/:id/assets`
- `POST /api/generations`
- `GET /api/generations`
- `GET /api/generations/:id`
- `POST /api/generations/:id/retry`
- `GET /api/billing/overview`
- `GET /api/admin/users`
- `POST /api/admin/quotas/allocate`

所有接口必须：
- 校验 session
- 校验资源归属或权限
- 使用 Zod 校验请求体
- 使用统一错误结构返回

---

## 10. 队列与任务策略

### 10.1 Job 类型
- generation.submit
- generation.poll
- generation.persist
- generation.retry
- billing.reconcile

### 10.2 轮询策略
建议：
- 前 3 分钟：15 秒一次
- 3–10 分钟：30 秒一次
- 10 分钟以后：60 秒一次
- 超过阈值标记异常并告警

### 10.3 Persist 重试
- 立即重试 3 次
- 指数退避
- 失败进入 dead-letter
- 对用户展示“生成成功但持久化失败，请尽快下载临时结果”

---

## 11. 安全要求

必须遵守：

- `ARK_API_KEY` 仅服务端可见
- 对象存储密钥仅服务端使用
- 下载走短期签名 URL 或受控下载网关
- 素材与任务读取必须校验权限，防止 IDOR
- 上传必须校验 MIME、大小、时长、维度
- 管理后台所有额度变更必须写审计日志
- 关键外部请求要有超时、重试、熔断基础能力

---

## 12. 非功能要求

- TypeScript strict 模式
- 服务端统一日志结构
- 关键链路埋点：创建、轮询、成功、失败、持久化、扣费
- 数据库 migration 可执行
- 环境变量必须有 schema 校验
- 外部适配器必须具备契约测试或集成测试

---

## 13. Cursor + agency-agents 使用方式

### 13.1 安装

在项目根目录安装 agency-agents 到 Cursor：

```bash
/path/to/agency-agents/scripts/install.sh --tool cursor
```

### 13.2 建议常驻规则

建议为以下 agents 开启自动应用或高频使用：

- `backend-architect`
- `frontend-developer`
- `security-engineer`
- `devops-automator`
- `technical-writer`
- `rapid-prototyper`

### 13.3 项目专用规则

除了 agency-agents 生成的规则外，再手动创建以下项目规则文件：

- `seedance-domain.mdc`
- `seedance-architecture.mdc`
- `seedance-security.mdc`
- `seedance-engineering.mdc`

这些规则用于强制 Cursor 始终遵循本项目的 API 约束、权限策略、异步架构和工程规范。

---

## 14. Cursor 执行顺序

请严格按以下顺序推进，不要跳步。

### 阶段 1：初始化仓库骨架
任务：
- 初始化 Next.js + TypeScript + Tailwind + shadcn/ui
- 初始化 Prisma + PostgreSQL
- 初始化 Redis + BullMQ
- 初始化 Auth.js
- 初始化 packages 分层
- 建立 `.env.example`
- 建立基础 README

### 阶段 2：建立领域模型与数据库
任务：
- 设计 Prisma schema
- 建立用户、项目、库、素材、任务、额度等表
- 输出 migration
- 建立 seed 数据脚本

### 阶段 3：完成后端主链路
任务：
- 实现 ArkAdapter
- 实现 GenerationService
- 实现 AssetLibraryService
- 实现 BillingService
- 实现 Worker 与 Job
- 实现持久化上传

### 阶段 4：完成前端主界面
任务：
- 登录页
- 工作台
- 历史页
- 后台页
- 权限感知的素材库 UI
- 任务轮询与结果展示

### 阶段 5：安全与稳定性
任务：
- 权限检查
- 错误边界
- 重试机制
- 审计日志
- Sentry
- 集成测试

### 阶段 6：文档与交付
任务：
- 架构文档
- API 文档
- 部署说明
- 运维 Runbook
- 失败重试说明

---

## 15. 可直接复制给 Cursor 的执行提示词

### Prompt 1：初始化项目

```text
@rapid-prototyper @backend-architect
初始化一个 monorepo 项目，用于构建 Seedance 视频生成平台。
要求：
1. 使用 Next.js 15 + TypeScript + App Router
2. 使用 Tailwind + shadcn/ui
3. 使用 Prisma + PostgreSQL
4. 使用 Redis + BullMQ
5. 使用 Auth.js
6. 目录结构采用 apps/web + packages/*
7. 输出完整项目骨架、package.json、tsconfig、eslint、prettier、env schema
8. TypeScript 必须 strict
9. 不要引入与本项目无关的依赖
```

### Prompt 2：数据库设计

```text
@backend-architect
基于以下业务设计 Prisma schema：
- 用户、团队、项目、素材库、素材、任务、任务输入、任务输出、额度、账本、审计日志
- 素材库权限支持 read / edit
- GenerationTask 需要区分平台状态与上游状态
- 任务成功后要记录持久化对象路径
- 账本按 total_tokens 记账，completion_tokens 用于对账
要求：
1. 生成完整 schema.prisma
2. 给出关键索引
3. 给出 migration 说明
4. 解释设计原因
```

### Prompt 3：Ark API 适配器

```text
@backend-architect @security-engineer
实现 BytePlus Ark API 适配器。
要求：
1. 封装 createTask / getTask
2. ARK_API_KEY 只能在服务端读取
3. 统一错误处理
4. 设置超时与基础重试
5. 支持 model 与 endpoint id 映射
6. 类型定义完整
7. 提供单元测试
```

### Prompt 4：任务创建与轮询

```text
@backend-architect
实现 GenerationService 和 BullMQ jobs。
要求：
1. 创建任务前校验模型能力差异
2. 校验互斥模式
3. 禁止仅音频输入
4. 创建 Ark 任务后写入本地 GenerationTask
5. 推送 generation.poll job
6. PollingWorker 查询任务状态并更新数据库
7. 成功后触发 generation.persist job
8. 失败后写入结构化错误并支持 retry
```

### Prompt 5：对象存储持久化

```text
@backend-architect @devops-automator @security-engineer
实现对象存储持久化模块。
要求：
1. 抽象 ObjectStorageProvider 接口
2. 先实现 GCS 和 OSS 的适配器骨架
3. PersistWorker 从 Ark 临时 URL 拉取视频并上传对象存储
4. 数据库记录 object_key、mime_type、file_size、storage_provider
5. 下载统一使用短期签名 URL
6. 重试、日志、失败告警完整
```

### Prompt 6：工作台页面

```text
@frontend-developer
实现 Seedance 创作工作台页面。
要求：
1. 三栏布局：素材库 / 创作表单 / 任务面板
2. 模型切换时动态禁用非法能力
3. 支持文生、首帧图生、首尾帧图生、多模态参考、编辑、续写入口
4. 但 fast 模型必须隐藏或禁用不支持的功能
5. 使用 React Hook Form + Zod
6. 使用 shadcn/ui 和 Tailwind
7. 提供清晰的错误提示与 loading 状态
```

### Prompt 7：权限系统

```text
@security-engineer @backend-architect
实现项目与素材库权限系统。
要求：
1. 用户默认有私有库
2. 项目库支持成员 read / edit
3. 服务端强制校验权限
4. 所有 asset / generation / library API 防止越权读取
5. 输出中间件、helper、测试用例
```

### Prompt 8：计费与后台

```text
@backend-architect @frontend-developer
实现 Token 额度与管理后台。
要求：
1. 创建任务前检查余额
2. 成功后按 total_tokens 扣费
3. 保存 completion_tokens 用于对账
4. 管理员可发放额度与查看账本
5. 后台展示用户、额度、任务统计、审计日志
```

### Prompt 9：安全审查

```text
@security-engineer
对当前项目进行一次完整安全审查。
重点检查：
1. API Key 暴露风险
2. 对象存储访问风险
3. IDOR
4. 权限绕过
5. 文件上传校验缺失
6. 后台越权
7. 日志中是否泄露敏感信息
输出修复清单，并直接给出补丁。
```

### Prompt 10：交付文档

```text
@technical-writer
为本项目输出交付文档。
包括：
1. README
2. 架构总览
3. 本地开发指南
4. 环境变量说明
5. 队列与任务说明
6. 对象存储说明
7. 故障排查 Runbook
8. 上游 Ark API 约束说明
要求：
- 文档清晰
- 与代码结构一致
- 面向新开发者可直接上手
```

---

## 16. 自定义 Cursor 规则建议内容

### 16.1 `seedance-domain.mdc`
要求 Cursor 始终遵守：
- 以 Ark API 为主通路
- 区分 Seedance 2.0 / fast 能力差异
- 遵守模式互斥
- 禁止仅音频
- 成功后必须自动持久化

### 16.2 `seedance-architecture.mdc`
要求 Cursor 始终遵守：
- App Server + Worker + Queue
- 所有外部能力通过 Adapter 封装
- 结果展示优先使用持久化资源
- 状态机必须清晰

### 16.3 `seedance-security.mdc`
要求 Cursor 始终遵守：
- API Key 仅服务端
- 所有下载受控
- 服务端强制权限校验
- 后台变更写审计

### 16.4 `seedance-engineering.mdc`
要求 Cursor 始终遵守：
- TypeScript strict
- Zod 校验
- Prisma migration 完整
- 外部适配器有测试
- 不生成无用抽象

---

## 17. 首版里程碑

### M1：骨架跑通
- 项目初始化
- 登录
- Prisma + PostgreSQL
- Redis + BullMQ
- 基础目录与规则

### M2：生成主链路跑通
- 文生视频
- 图生首帧视频
- Ark create / poll
- 成功后持久化
- 历史页可下载

### M3：团队与权限
- 项目库
- read / edit 权限
- 管理后台基础额度功能

### M4：高级能力
- 多模态参考
- 参考视频
- 编辑
- 续写
- 更完善的重试与审计

---

## 18. 交付标准

当以下条件同时满足时，视为首版可交付：

1. 用户可登录并进入工作台
2. 可创建 Seedance 任务并看到状态变化
3. 成功后视频被自动持久化并稳定下载
4. 历史页可查看生成记录
5. 项目库成员权限生效
6. 管理员可管理额度
7. 关键链路有日志与基础告警
8. 文档齐全，新成员可按 README 本地跑通

---

## 19. 最终执行要求

Cursor 在执行本项目时必须遵守：

- 先搭骨架，再做数据库，再接上游，再做前端，再做安全与文档
- 不要直接堆叠页面代码，先定义领域模型和服务边界
- 不要把轮询、转存、计费逻辑塞到前端
- 不要把 Ark 临时 URL 当作长期资源
- 不要只做前端限制而缺失服务端校验
- 所有代码以“能落地运行”为标准，而不是概念性伪实现

