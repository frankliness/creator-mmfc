import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // standalone 追踪有时会漏掉仅被少数 Route 引用的依赖，显式打进产物
  outputFileTracingIncludes: {
    "**/api/projects/**/download-batch/**": [
      "./node_modules/archiver/**/*",
    ],
  },
  /**
   * MMFC-canvas SPA 静态产物部署在 public/canvas/，根目录 index.html。
   * Next.js 的 App 路由不得占用 `/canvas`（否则 iframe 会加载到 React 壳而非 Vue SPA）。
   * 主站入口页放在 `app/ai-canvas/`，iframe 仍指向 `/canvas/*`。
   *
   * 内部使用 vue-router history 模式，深链如 /canvas/edit/xxx 需回落到 index.html。
   * `/canvas`、`/canvas/` 显式 rewrite，避免部分环境下目录 URL 未命中 index。
   * `/canvas/assets/*` 仍由 public 静态文件优先匹配，不会落到 rewrite。
   */
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/canvas",
          destination: "/canvas/index.html",
        },
        {
          source: "/canvas/",
          destination: "/canvas/index.html",
        },
        {
          source: "/canvas/:path((?!assets|favicon.ico|index.html).*)",
          destination: "/canvas/index.html",
        },
      ],
      beforeFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
