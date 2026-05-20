import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // standalone 追踪有时会漏掉仅被少数 Route 引用的依赖，显式打进产物
  outputFileTracingIncludes: {
    "**/api/projects/**/download-batch/**": [
      "./node_modules/archiver/**/*",
    ],
    // v2.0.0：这些 Node 库使用动态 require / 平台特定二进制 / 带 README 的子包，
    // 必须把整个目录打进 standalone 产物（包括平台二进制）
    "**/api/workspace/series/**/assets/**": [
      "./node_modules/ali-oss/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/fluent-ffmpeg/**/*",
      "./node_modules/@ffmpeg-installer/**/*",
      "./node_modules/@ffprobe-installer/**/*",
    ],
    "**/worker/**": [
      "./node_modules/ali-oss/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/fluent-ffmpeg/**/*",
      "./node_modules/@ffmpeg-installer/**/*",
      "./node_modules/@ffprobe-installer/**/*",
    ],
  },
  /**
   * v2.0.0：这些库使用 dynamic require、读 README/package.json、平台二进制：
   * Turbopack/webpack 都没法静态分析；标记为 server-external 让 Node 运行时直接 require。
   */
  serverExternalPackages: [
    "ali-oss",
    "sharp",
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
  ],
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
