/**
 * Provider 错误分类 —— 用于画布生图渠道轮询的限流降级判定。
 *
 * 错误来源：
 *   - parseOpenAIImageResponse：失败时 `throw new Error(errMsg)`，errMsg = body.error.message
 *     或 `图片生成失败 HTTP <status>`。Azure 限流形如：
 *       `Requests to the ChatCompletions Operation under Azure OpenAI API version
 *        2024-08-01-preview have exceeded token rate limit ... Please retry after 30 seconds.`
 *     或 body.error.code = "429" / "RateLimitReached"。
 *   - Gemini：image.ts 抛出 `parseGeminiImageResponse` 的 errMsg 或上游 4xx/5xx 文本，
 *     429 时通常含 "RESOURCE_EXHAUSTED" 或 "rate limit"。
 *   - image-task-runner 超时包装：`provider 调用超过 ${N}s 上限` —— 归 timeout。
 *
 * 这里只做字符串/数字匹配，不做网络回调；保持纯函数易测。
 */

export type FailureKind = "rate_limit" | "provider_error" | "timeout" | "other";

export interface ClassifiedError {
  isRateLimit: boolean;
  /** 解析到的 Retry-After 毫秒；rate_limit 时为 worker 设 cooldownUntil 的依据，无则上游兜底 30s */
  retryAfterMs?: number;
  kind: FailureKind;
}

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /\b429\b/,
  /rate[\s_-]?limit/i,
  /ratelimitreached/i,
  /too\s+many\s+requests/i,
  /requests?\s+per\s+(minute|second|day)/i,
  /resource[_-]?exhausted/i,
  /quota.*(exceed|exhaust)/i,
  /please\s+retry/i,
];

const TIMEOUT_PATTERNS: RegExp[] = [
  /provider\s*调用超过.*上限/,
  /\btimed?\s*out\b/i,
  /\bETIMEDOUT\b/,
  /AbortError/i,
];

const PROVIDER_ERROR_PATTERNS: RegExp[] = [
  /\bHTTP\s+5\d\d\b/,
  /\b50[0-4]\b/,
  /bad\s+gateway/i,
  /service\s+unavailable/i,
  /upstream/i,
];

/** 从消息里抓 "retry after 30 seconds" / "retry after 1500ms" / `Retry-After: 30` 等。 */
function extractRetryAfterMs(message: string): number | undefined {
  // "retry after 30 seconds" / "retry in 30 seconds"
  const sec = message.match(/retry[\s\w]*?(\d+)\s*(?:s|sec|second|seconds)\b/i);
  if (sec) {
    const v = Number(sec[1]);
    if (Number.isFinite(v) && v > 0) return Math.min(v, 600) * 1000;
  }
  // "retry after 1500ms"
  const ms = message.match(/retry[\s\w]*?(\d+)\s*ms\b/i);
  if (ms) {
    const v = Number(ms[1]);
    if (Number.isFinite(v) && v > 0) return Math.min(v, 600_000);
  }
  // "Retry-After: 30" header echoed in body
  const header = message.match(/retry[-\s]?after\s*[:=]\s*(\d+)/i);
  if (header) {
    const v = Number(header[1]);
    if (Number.isFinite(v) && v > 0) return Math.min(v, 600) * 1000;
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function classifyError(err: unknown): ClassifiedError {
  const msg = readMessage(err);
  if (!msg) {
    return { isRateLimit: false, kind: "other" };
  }

  // 优先判超时：429 误判风险低（超时消息不含 "rate limit"）
  if (TIMEOUT_PATTERNS.some((re) => re.test(msg))) {
    return { isRateLimit: false, kind: "timeout" };
  }

  if (RATE_LIMIT_PATTERNS.some((re) => re.test(msg))) {
    return {
      isRateLimit: true,
      retryAfterMs: extractRetryAfterMs(msg),
      kind: "rate_limit",
    };
  }

  if (PROVIDER_ERROR_PATTERNS.some((re) => re.test(msg))) {
    return { isRateLimit: false, kind: "provider_error" };
  }

  return { isRateLimit: false, kind: "other" };
}
