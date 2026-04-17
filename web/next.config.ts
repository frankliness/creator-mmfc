import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // standalone 追踪有时会漏掉仅被少数 Route 引用的依赖，显式打进产物
  outputFileTracingIncludes: {
    "**/api/projects/**/download-batch/**": [
      "./node_modules/archiver/**/*",
    ],
  },
};

export default nextConfig;
