# syntax=docker/dockerfile:1.7
#
# Build context expected at REPO ROOT（docker-compose.yml 中
# `web-app.build.context: .`、`dockerfile: ./web/Dockerfile`）。
# 这样我们可以同时访问 web/ 与 MMFC-canvas/ 两个子项目。
FROM node:20-alpine AS base

# 1) 安装主站依赖
FROM base AS deps
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci

# 2) 安装画布依赖（MMFC-canvas 使用 pnpm 管理）
FROM base AS canvas-deps
WORKDIR /canvas
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY MMFC-canvas/package.json MMFC-canvas/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 3) 构建画布前端 → /canvas/dist（vite base='/canvas/'）
FROM base AS canvas-builder
WORKDIR /canvas
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=canvas-deps /canvas/node_modules ./node_modules
COPY MMFC-canvas/ ./
RUN pnpm run build

# 4) 构建主站
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
# 把画布产物拷进 Next.js public/，部署后访问 /canvas/index.html 直达
RUN mkdir -p ./public/canvas
COPY --from=canvas-builder /canvas/dist/ ./public/canvas/
RUN npx prisma generate
RUN npm run build

# 5) Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /data/videos /data/canvas-images \
 && chown -R nextjs:nodejs /data/videos /data/canvas-images

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=builder /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps

COPY --from=builder /app/package.json /app/package-lock.json ./
USER root
RUN npm install --omit=dev @google-cloud/storage archiver && chown -R nextjs:nodejs /app/node_modules
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
