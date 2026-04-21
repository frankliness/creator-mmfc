import { getGlobalConfig } from "@/lib/global-config";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function trimBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/openai$/, "");
}

async function getBaseUrl(): Promise<string> {
  const fromConfig = await getGlobalConfig("gemini_base_url");
  if (fromConfig) return trimBase(fromConfig);
  if (process.env.GEMINI_BASE_URL) return trimBase(process.env.GEMINI_BASE_URL);
  return DEFAULT_BASE;
}

async function getApiKey(): Promise<string> {
  const fromConfig = await getGlobalConfig("gemini_api_key");
  if (fromConfig) return fromConfig;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  throw new Error("Gemini API Key 未配置（GlobalConfig.gemini_api_key 或 env.GEMINI_API_KEY）");
}

/** 入参图片：base64 直传或 data URL，或 publicUrl/远程 URL（由调用方在 API 路由层解析为 base64）。 */
export interface GeminiImageRefPart {
  mimeType: string;
  /** base64（不含 data:; 前缀） */
  data: string;
}

export interface GeminiGenerateImageInput {
  model: string;
  prompt: string;
  /** 1:1 / 16:9 / 9:16 等 */
  aspectRatio?: string;
  /** 1K / 2K 等 imageSize 取值，按 Google 文档传 */
  imageSize?: string;
  refImages?: GeminiImageRefPart[];
}

export interface GeminiUsage {
  inputTokens: bigint;
  outputTokens: bigint;
  totalTokens: bigint;
}

export interface GeminiImageOutput {
  mimeType: string;
  base64: string;
}

export interface GeminiImageResult {
  images: GeminiImageOutput[];
  revisedPrompt: string;
  usage: GeminiUsage;
  raw: unknown;
}

/**
 * 调用 Google 官方 Gemini ：generateContent，原生图片 API。
 * 仅在 server 端使用，自动从 GlobalConfig 取 Key，绝不暴露给前端。
 */
export async function generateGeminiImage(input: GeminiGenerateImageInput): Promise<GeminiImageResult> {
  const baseUrl = await getBaseUrl();
  const apiKey = await getApiKey();

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];
  if (input.prompt) parts.push({ text: input.prompt });
  for (const img of input.refImages || []) {
    if (!img?.data) continue;
    parts.push({ inline_data: { mime_type: img.mimeType || "image/png", data: img.data } });
  }

  const imageConfig: Record<string, string> = {};
  if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio;
  if (input.imageSize) imageConfig.imageSize = input.imageSize;

  const generationConfig: Record<string, unknown> = {
    // Force image output so the route doesn't intermittently receive text-only responses.
    responseModalities: ["IMAGE"],
  };
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }
  const payload: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig,
  };

  const url = `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string }; message?: string })?.error?.message ||
      (data as { message?: string })?.message ||
      `Gemini 图片生成失败 HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return parseGeminiImageResponse(data);
}

type InlineData = { mime_type?: string; mimeType?: string; data?: string };
interface GeminiPart {
  text?: string;
  inline_data?: InlineData;
  inlineData?: InlineData;
}

function parseGeminiImageResponse(data: unknown): GeminiImageResult {
  const root = (data || {}) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };

  const allParts: GeminiPart[] = (root.candidates || []).flatMap((c) => c.content?.parts || []);

  const images: GeminiImageOutput[] = [];
  const textChunks: string[] = [];
  for (const part of allParts) {
    const inline: InlineData | undefined = part.inline_data || part.inlineData;
    if (inline?.data) {
      images.push({
        mimeType: inline.mime_type || inline.mimeType || "image/png",
        base64: inline.data,
      });
    } else if (typeof part.text === "string") {
      textChunks.push(part.text);
    }
  }

  const usageMeta = root.usageMetadata || {};
  const usage: GeminiUsage = {
    inputTokens: BigInt(usageMeta.promptTokenCount ?? 0),
    outputTokens: BigInt(usageMeta.candidatesTokenCount ?? 0),
    totalTokens: BigInt(usageMeta.totalTokenCount ?? (usageMeta.promptTokenCount ?? 0) + (usageMeta.candidatesTokenCount ?? 0)),
  };

  return {
    images,
    revisedPrompt: textChunks.join("\n").trim(),
    usage,
    raw: data,
  };
}

/** 暴露给 chat 路由复用：拿 base 与 key（chat 走 OpenAI 兼容端点）。 */
export async function getGeminiAccess(): Promise<{ baseUrl: string; openaiBase: string; apiKey: string }> {
  const baseUrl = await getBaseUrl();
  const apiKey = await getApiKey();
  return {
    baseUrl,
    openaiBase: `${baseUrl}/openai`,
    apiKey,
  };
}
