# Creator MMFC

**版本：1.1.2**

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

### 版本 1.1.2 更新摘要

相对 **1.1.1** 的主要变更（**MMFC Studio Canvas** 为主）：

- **性能与内存**：画布 `canvas` store 用 `mutationVersion` 触发自动保存，替代对 `nodes` / `edges` 的 deep watch；撤销历史在入栈前剥离 `base64`、`maskData` 等重字段，并增加约 30MB 的软字节上限与 FIFO 裁剪，降低大图编辑时的内存峰值与卡顿。
- **参考图上传**：图片节点本地上传优先走 `uploadAsset`，节点内保存 HTTP `url`（及 `assetId` 等），避免整图 data URL 长期驻留在快照与请求体中；单文件约 12MB 上限，**413** 明确提示压缩重试，其它错误仍可回退为内嵌 data URL（并提示可能影响性能）。
- **LLM / 文本节点**：`LLMConfigNode`、`TextNode` 的流式对话与「润色」改为直接调用 `streamChatCompletions`（`api` 层），与项目上下文、模型适配逻辑对齐；`TextNode` 润色使用常量 system 文案，避免多余响应式闭包。
- **Vue Flow 节点**：`ImageConfigNode`、`VideoConfigNode` 将原先对 `props.data` 的 deep watch 收窄为监听影响尺寸与 handle 的字段，减少全图 `updateNodeInternals` 连锁触发。
- **视频节点**：本地上传替换前 `URL.revokeObjectURL` 释放旧 blob，卸载组件时释放当前 blob，避免 blob URL 与文件字节累积。
- **体验与可观测**：新增 `MessageBridge` 将 Naive UI `useMessage` 挂到 `window.$message`，避免各节点里可选链静默无提示；开发环境可选 `memDebug` 周期性输出堆占用（生产为 no-op）。

更早的 **1.1.1** 相对 **1.1.0** 的变更（数据模型、快照 API、ARCHITECTURE 等）仍见上文仓库结构与 [ARCHITECTURE.md](ARCHITECTURE.md)；升级已有数据库时请继续执行 `prisma migrate deploy`（或 CI 等价步骤）应用 1.1.1 起包含的迁移。

## 环境要求

- **Docker** 与 **Docker Compose**（推荐 v2）
- 可选本地开发：**Node.js ≥ 18**、**pnpm / npm**（各子项目 `package.json`）

## 一键启动（Docker）

在仓库**根目录**：

```bash
cp .env.docker.example .env
# 编辑 .env：至少填写 DB_PASSWORD、NEXTAUTH_SECRET、ENCRYPTION_KEY；按需填写 GEMINI / Seedance 等
docker compose up -d --build
```

默认端口（可在 `.env` 中调整）：

| 服务 | 地址 |
|------|------|
| 用户端 | http://localhost:3000 |
| 管理后台 Web | http://localhost:8080 |

首次启动会由 `db-init` 执行 `prisma db push` 与种子数据。若本地 Postgres 卷与当前 schema 严重不一致，可参考 `.env.docker.example` 内注释处理 `PRISMA_ACCEPT_DATA_LOSS`（**仅限开发库**）。

### GCS（可选）

若不上传 GCS，请勿将真实服务账号 JSON 提交仓库；未使用时需从 [`docker-compose.yml`](docker-compose.yml) 中移除 `web-app` / `web-worker` 上绑定 `gcs-credentials` 的 **bind mount** 行，并在 `.env` 中不配 `GCS_*`，否则可能因宿主机缺少文件导致容器启动失败。详见 `.env.docker.example` 注释。

## 本地开发（概要）

各子项目可单独安装依赖并运行；数据库需与本机或 Docker 中的 Postgres 一致。管理端本地流程可参考 [admin/README.md](admin/README.md)；用户端可参考 [web/README.md](web/README.md)（以实际脚本为准）。

## 安全与配置

- **切勿**将 `.env`、服务账号 JSON、`*.pem` 等密钥提交到 Git。仓库已通过 `.gitignore` 忽略常见敏感路径；复制 `.env*.example` 后本地填写。
- 生产环境务必修改默认密钥类变量（如 `NEXTAUTH_SECRET`、`ADMIN_JWT_SECRET`、`DB_PASSWORD`）。

## 许可证

若各子目录另有 LICENSE，以子目录为准；未特别声明时以本仓库根目录策略为准。
