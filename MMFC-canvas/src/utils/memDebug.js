/**
 * Dev-only heap memory probe.
 * 仅 import.meta.env.DEV 下生效，30s 周期 console.warn 一次 usedJSHeapSize（Chromium 系才有）。
 * - 不上报任何后端、不写日志文件、不修改 UI；
 * - 生产构建会被 tree-shake / 早退（import.meta.env.DEV === false）。
 *
 * 用途：定位画布 OOM 时观察堆增长趋势；不要用于线上监控。
 */
export const startMemDebug = () => {
  if (!import.meta.env.DEV) return
  if (typeof performance === 'undefined' || !performance.memory) return

  const fmt = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`
  setInterval(() => {
    const m = performance.memory
    // 用 warn 是为了在浏览器 console 里默认就能高亮看到
    console.warn(
      `[mem] used=${fmt(m.usedJSHeapSize)} total=${fmt(m.totalJSHeapSize)} limit=${fmt(m.jsHeapSizeLimit)}`
    )
  }, 30_000)
}
