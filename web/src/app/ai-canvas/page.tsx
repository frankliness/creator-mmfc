"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * AI 画布入口页（/ai-canvas）：iframe 加载 Vue SPA（public/canvas/index.html，URL 前缀 /canvas/）。
 *
 * 关键点：
 * - iframe 同源，自动复用 NextAuth 会话 cookie；
 * - 监听 postMessage 接收画布内"返回主站"事件，调用 router.push 跳转；
 * - iframe 高度 = 100vh - 56px(NavHeader)；这里通过 calc 控制。
 */
export default function CanvasPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "creator-mmfc:canvas:back") {
        const target = typeof data.target === "string" && data.target.startsWith("/")
          ? data.target
          : "/dashboard";
        router.push(target);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [router]);

  return (
    <div className="h-[calc(100vh-56px)] w-full bg-background">
      <iframe
        ref={iframeRef}
        title="MMFC Canvas"
        src="/canvas/"
        className="h-full w-full border-0"
        // sandbox 暂不限制，画布同源且需要使用剪贴板/弹窗
      />
    </div>
  );
}
