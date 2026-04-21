import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { checkChatQuota } from "@/lib/canvas/canvas-quota";
import { logCanvasCall } from "@/lib/canvas/canvas-logger";
import { getGeminiAccess } from "@/lib/canvas/gemini-image";
import { readCanvasAsset } from "@/lib/canvas/canvas-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageContentSchema = z.union([
  z.string(),
  z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
    ])
  ),
]);

const bodySchema = z.object({
  projectId: z.string().min(1).optional(),
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: messageContentSchema,
    })
  ),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  reasoning_effort: z.string().optional(),
});

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;
const CANVAS_ASSET_PATH_RE = /^\/api\/canvas\/assets\/([^/?#]+)(?:[?#].*)?$/i;

interface UsageAccumulator {
  inputTokens: bigint;
  outputTokens: bigint;
  totalTokens: bigint;
}

/** 解析 OpenAI 兼容流式 chunk，累计 usage（仅最后一帧带）+ 估算 output tokens fallback。 */
function makeUsageParser(): {
  accept: (jsonChunk: string) => void;
  acceptDelta: (delta: string) => void;
  finalize: () => UsageAccumulator;
} {
  const ZERO = BigInt(0);
  let usage: UsageAccumulator = { inputTokens: ZERO, outputTokens: ZERO, totalTokens: ZERO };
  let outputCharCount = 0;
  let usageReceived = false;

  return {
    accept(jsonChunk) {
      try {
        const obj = JSON.parse(jsonChunk) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        if (obj.usage) {
          usage = {
            inputTokens: BigInt(obj.usage.prompt_tokens ?? 0),
            outputTokens: BigInt(obj.usage.completion_tokens ?? 0),
            totalTokens: BigInt(obj.usage.total_tokens ?? 0),
          };
          usageReceived = true;
        }
      } catch {
        /* ignore parse error */
      }
    },
    acceptDelta(delta) {
      outputCharCount += delta.length;
    },
    finalize() {
      if (!usageReceived && outputCharCount > 0) {
        // Gemini OpenAI 兼容端点理论上会回 usage，但若缺失就用字符数粗估（约 4 字符 ≈ 1 token）
        const approx = BigInt(Math.max(1, Math.round(outputCharCount / 4)));
        usage = {
          inputTokens: ZERO,
          outputTokens: approx,
          totalTokens: approx,
        };
      }
      return usage;
    },
  };
}

function extractCanvasAssetId(input: string): string | null {
  const direct = input.match(CANVAS_ASSET_PATH_RE);
  if (direct) return direct[1];

  try {
    const parsed = new URL(input);
    const pathnameMatch = parsed.pathname.match(CANVAS_ASSET_PATH_RE);
    return pathnameMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function loadOwnedCanvasAssetAsDataUrl(assetId: string, userId: string) {
  const asset = await prisma.canvasAsset.findUnique({
    where: { id: assetId },
    select: {
      userId: true,
      mimeType: true,
      localPath: true,
      gcsPath: true,
    },
  });

  if (!asset || asset.userId !== userId) {
    throw new Error(`参考图资源不存在或无权访问: ${assetId}`);
  }

  const file = await readCanvasAsset({
    localPath: asset.localPath,
    gcsPath: asset.gcsPath,
  });
  if (!file) {
    throw new Error(`参考图文件缺失: ${assetId}`);
  }

  return `data:${asset.mimeType || "image/png"};base64,${file.buffer.toString("base64")}`;
}

async function normalizeMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> }>,
  userId: string
) {
  return Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.content)) return message;

      const content = await Promise.all(
        message.content.map(async (part) => {
          if (part.type !== "image_url") return part;

          const url = part.image_url.url;
          if (DATA_URL_RE.test(url)) return part;

          const assetId = extractCanvasAssetId(url);
          if (!assetId) return part;

          return {
            type: "image_url" as const,
            image_url: {
              url: await loadOwnedCanvasAssetAsDataUrl(assetId, userId),
            },
          };
        })
      );

      return { ...message, content };
    })
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const quota = await checkChatQuota(auth.user.id);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 429 });
  }

  let access;
  try {
    access = await getGeminiAccess();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gemini 配置错误" },
      { status: 500 }
    );
  }

  const upstreamUrl = `${access.openaiBase}/chat/completions`;
  const upstreamPayload = {
    model: parsed.data.model,
    messages: parsed.data.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(parsed.data.temperature !== undefined ? { temperature: parsed.data.temperature } : {}),
    ...(parsed.data.max_tokens !== undefined ? { max_tokens: parsed.data.max_tokens } : {}),
    ...(parsed.data.reasoning_effort !== undefined ? { reasoning_effort: parsed.data.reasoning_effort } : {}),
  };

  const startedAt = Date.now();
  let normalizedMessages;
  try {
    normalizedMessages = await normalizeMessages(parsed.data.messages, auth.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "图片输入处理失败";
    await logCanvasCall({
      userId: auth.user.id,
      projectId: parsed.data.projectId ?? null,
      callType: "canvas_chat",
      model: parsed.data.model,
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access.apiKey}`,
    },
    body: JSON.stringify({
      ...upstreamPayload,
      messages: normalizedMessages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    await logCanvasCall({
      userId: auth.user.id,
      projectId: parsed.data.projectId ?? null,
      callType: "canvas_chat",
      model: parsed.data.model,
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: text.slice(0, 1000) || `HTTP ${upstream.status}`,
    });
    return NextResponse.json(
      { error: `Gemini 调用失败 HTTP ${upstream.status}`, details: text.slice(0, 1000) },
      { status: 502 }
    );
  }

  const usageParser = makeUsageParser();
  const decoder = new TextDecoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // 直接透传给前端，不破坏 SSE 帧
          controller.enqueue(value);

          // 同步缓冲解析一份，用于 token 统计
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            usageParser.accept(payload);
            try {
              const parsedChunk = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsedChunk.choices?.[0]?.delta?.content;
              if (typeof delta === "string") usageParser.acceptDelta(delta);
            } catch {
              /* ignore */
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        const usage = usageParser.finalize();
        await logCanvasCall({
          userId: auth.user.id,
          projectId: parsed.data.projectId ?? null,
          callType: "canvas_chat",
          model: parsed.data.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          durationMs: Date.now() - startedAt,
          status: "success",
        });
      }
    },
  });

  // 透传必要的 SSE 头
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  // 显式禁用 Next.js 缓冲（避免代理累积）
  headers.set("X-Accel-Buffering", "no");

  return new Response(stream, { headers });
}
