# 构建上下文必须为仓库根目录（creator_mmfc），以便复制 web 端 prompt 源文件供 seed-prompts 使用。
# 根目录：docker compose -f docker-compose.yml build
# 仅 admin：在 admin 目录下使用 context: .. 与本 Dockerfile 路径 admin/server/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY admin/server/package*.json ./server/
COPY admin/prisma/ ./prisma/
RUN cd server && npm ci
RUN cd server && npx --no-install prisma generate --schema ../prisma/schema.prisma
COPY admin/server/ ./server/
RUN cd server && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/prisma ./prisma
# db-init 运行 seed-prompts 时读取（与代码库同步）
COPY web/src/lib/prompts/director-system.ts web/src/lib/prompts/storyboard-schema.ts ./seed-web/prompts/
COPY web/src/lib/gemini.ts ./seed-web/gemini.ts
COPY admin/scripts/seed-prompts.ts ./scripts/seed-prompts.ts
ENV NODE_ENV=production
ENV SEED_PROMPT_SOURCE_DIR=/app/seed-web/prompts
ENV SEED_GEMINI_FILE=/app/seed-web/gemini.ts
EXPOSE 3100
CMD ["node", "dist/index.js"]
