import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { decrypt } from "../../common/crypto.js";
import { requirePermission } from "../../common/guards/permission.js";

const PURPOSES = ["chat", "storyboard", "canvas_image", "canvas_image_edit"] as const;
type Purpose = (typeof PURPOSES)[number];

const testSchema = z.object({
  purpose: z.enum(PURPOSES),
});

interface ResolvedConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  deployment?: string;
  apiVersion?: string;
}

/** 与 web/src/lib/llm/config-resolver.ts 同款；剥常见 endpoint 后缀，admin 粘贴完整 URL 时不会出错 */
function normalizeBase(url: string): string {
  let result = (url || "").trim().replace(/\/+$/, "");
  const endpointSuffixes = [
    "/chat/completions",
    "/images/generations",
    "/images/edits",
    "/images/variations",
    "/embeddings",
    "/audio/speech",
    "/audio/transcriptions",
    "/audio/translations",
    "/responses",
    "/completions",
  ];
  for (const suffix of endpointSuffixes) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  result = result.replace(/\/openai$/, "");
  return result;
}

/** 从 GlobalConfig 表读取一个用途的完整配置；未配置任一关键字段返回 null。 */
async function loadPurposeConfig(purpose: Purpose): Promise<ResolvedConfig | null> {
  const fields = ["provider", "base_url", "api_key", "model", "deployment", "api_version"];
  const keys = fields.map((f) => `${purpose}_${f}`);
  const records = await prisma.globalConfig.findMany({ where: { key: { in: keys } } });
  const map = new Map(records.map((r) => [r.key, r]));

  const provider = map.get(`${purpose}_provider`)?.value;
  const baseUrl = map.get(`${purpose}_base_url`)?.value;
  const apiKeyRecord = map.get(`${purpose}_api_key`);

  if (!provider || !baseUrl || !apiKeyRecord?.value) return null;

  let apiKey: string;
  try {
    apiKey = apiKeyRecord.encrypted ? decrypt(apiKeyRecord.value) : apiKeyRecord.value;
  } catch {
    return null;
  }

  return {
    provider,
    baseUrl: normalizeBase(baseUrl),
    apiKey,
    model: map.get(`${purpose}_model`)?.value,
    deployment: map.get(`${purpose}_deployment`)?.value,
    apiVersion: map.get(`${purpose}_api_version`)?.value,
  };
}

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  provider: string;
  modelsCount?: number;
}

/** 探测请求：调 /models 端点验证 auth + 网络可达。 */
async function probe(config: ResolvedConfig): Promise<ProbeResult> {
  const startMs = Date.now();
  const base = config.baseUrl.replace(/\/+$/, "");

  let url: string;
  let headers: Record<string, string>;

  switch (config.provider) {
    case "azure_openai": {
      const version = config.apiVersion || "2024-08-01-preview";
      url = `${base}/openai/models?api-version=${version}`;
      headers = { "api-key": config.apiKey };
      break;
    }
    case "google": {
      const cleanBase = base.replace(/\/openai$/, "");
      url = `${cleanBase}/openai/models`;
      headers = { Authorization: `Bearer ${config.apiKey}` };
      break;
    }
    default: {
      // openai / custom — 标准 OpenAI 协议
      url = `${base}/models`;
      headers = { Authorization: `Bearer ${config.apiKey}` };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startMs;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        status: res.status,
        error: text.slice(0, 500) || `HTTP ${res.status}`,
        provider: config.provider,
      };
    }

    let modelsCount: number | undefined;
    try {
      const data = (await res.json()) as { data?: unknown[] };
      if (Array.isArray(data.data)) modelsCount = data.data.length;
    } catch {
      // ignore parse errors — auth 通过即视为成功
    }

    return {
      ok: true,
      latencyMs,
      status: res.status,
      provider: config.provider,
      modelsCount,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : "网络请求失败",
      provider: config.provider,
    };
  }
}

export async function connectionTestRoutes(app: FastifyInstance) {
  // PRD §14.11：连接测试统一归入 credentials.write
  app.addHook("preHandler", requirePermission("credentials", "write"));

  app.post("/", async (request, reply) => {
    const parsed = testSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });
    }

    const config = await loadPurposeConfig(parsed.data.purpose);
    if (!config) {
      return reply.code(400).send({
        ok: false,
        error: `${parsed.data.purpose} 配置不完整（需 provider、base_url、api_key 全部填写）`,
      });
    }

    return await probe(config);
  });
}
