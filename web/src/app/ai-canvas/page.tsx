import { CanvasFrame } from "./canvas-frame";

/**
 * AI 画布入口页（/ai-canvas）：iframe 加载 Vue SPA（public/canvas/index.html，URL 前缀 /canvas/）。
 *
 * 关键点：
 * - iframe 同源，自动复用 NextAuth 会话 cookie；
 * - CanvasFrame 监听 postMessage，处理返回主站与项目 URL 同步；
 * - iframe 高度 = 100vh - 56px(NavHeader)；这里通过 calc 控制。
 */
export default function CanvasPage() {
  return <CanvasFrame />;
}
