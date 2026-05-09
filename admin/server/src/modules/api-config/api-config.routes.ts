import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireRole } from "../../common/guards/rbac.js";
import { encrypt, decrypt, maskApiKey } from "../../common/crypto.js";
import { createAuditLog } from "../../common/audit.js";

/** 与 connection-test 同款 base URL 归一化 */
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

const CALL_TYPES = ["video", "chat", "storyboard", "canvas_image", "canvas_image_edit"] as const;

const createSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().optional(),
  /** 用途分类；不填默认 video 兼容历史 Seedance 配置 */
  callType: z.enum(CALL_TYPES).default("video"),
  /** Azure 专用：部署名 */
  deployment: z.string().optional(),
  /** Azure 专用：api-version */
  apiVersion: z.string().optional(),
  isDefault: z.boolean().default(false),
});

const updateSchema = createSchema.partial();

export async function apiConfigRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/users/:userId/api-configs", async (request) => {
    const { userId } = request.params as { userId: string };
    const configs = await prisma.userApiConfig.findMany({
      where: { userId },
      orderBy: [{ callType: "asc" }, { createdAt: "desc" }],
    });

    return configs.map((c) => ({
      ...c,
      apiKey: maskApiKey(decrypt(c.apiKey)),
    }));
  });

  app.post("/users/:userId/api-configs", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "用户不存在" });

    // 一个用户在同一 callType 下只允许一个 default（跨 provider 也是唯一的）
    if (parsed.data.isDefault) {
      await prisma.userApiConfig.updateMany({
        where: { userId, callType: parsed.data.callType, isDefault: true },
        data: { isDefault: false },
      });
    }

    const config = await prisma.userApiConfig.create({
      data: {
        userId,
        provider: parsed.data.provider,
        name: parsed.data.name,
        endpoint: parsed.data.endpoint,
        apiKey: encrypt(parsed.data.apiKey),
        model: parsed.data.model,
        callType: parsed.data.callType,
        deployment: parsed.data.deployment,
        apiVersion: parsed.data.apiVersion,
        isDefault: parsed.data.isDefault,
      },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.create",
      targetType: "UserApiConfig",
      targetId: config.id,
      after: {
        userId,
        provider: parsed.data.provider,
        name: parsed.data.name,
        callType: parsed.data.callType,
      },
      ip: request.ip,
    });

    return { ...config, apiKey: maskApiKey(parsed.data.apiKey) };
  });

  app.patch("/users/:userId/api-configs/:configId", async (request, reply) => {
    const { userId, configId } = request.params as { userId: string; configId: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const existing = await prisma.userApiConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!existing) return reply.code(404).send({ error: "配置不存在" });

    const data: Record<string, unknown> = {};
    if (parsed.data.provider !== undefined) data.provider = parsed.data.provider;
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.endpoint !== undefined) data.endpoint = parsed.data.endpoint;
    if (parsed.data.apiKey !== undefined) data.apiKey = encrypt(parsed.data.apiKey);
    if (parsed.data.model !== undefined) data.model = parsed.data.model;
    if (parsed.data.callType !== undefined) data.callType = parsed.data.callType;
    if (parsed.data.deployment !== undefined) data.deployment = parsed.data.deployment;
    if (parsed.data.apiVersion !== undefined) data.apiVersion = parsed.data.apiVersion;

    if (parsed.data.isDefault !== undefined) {
      if (parsed.data.isDefault) {
        const targetCallType =
          (parsed.data.callType ?? existing.callType) || "video";
        await prisma.userApiConfig.updateMany({
          where: {
            userId,
            callType: targetCallType,
            isDefault: true,
            id: { not: configId },
          },
          data: { isDefault: false },
        });
      }
      data.isDefault = parsed.data.isDefault;
    }

    const updated = await prisma.userApiConfig.update({
      where: { id: configId },
      data,
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.update",
      targetType: "UserApiConfig",
      targetId: configId,
      before: {
        provider: existing.provider,
        name: existing.name,
        endpoint: existing.endpoint,
        callType: existing.callType,
      },
      after: data,
      ip: request.ip,
    });

    return { ...updated, apiKey: maskApiKey(decrypt(updated.apiKey)) };
  });

  app.delete("/users/:userId/api-configs/:configId", async (request, reply) => {
    const { userId, configId } = request.params as { userId: string; configId: string };
    const existing = await prisma.userApiConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!existing) return reply.code(404).send({ error: "配置不存在" });

    await prisma.userApiConfig.delete({ where: { id: configId } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.delete",
      targetType: "UserApiConfig",
      targetId: configId,
      before: { provider: existing.provider, name: existing.name, callType: existing.callType },
      ip: request.ip,
    });

    return { message: "配置已删除" };
  });

  app.post("/users/:userId/api-configs/:configId/test", async (request, reply) => {
    const { userId, configId } = request.params as { userId: string; configId: string };
    const config = await prisma.userApiConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!config) return reply.code(404).send({ error: "配置不存在" });

    const apiKey = decrypt(config.apiKey);
    const startMs = Date.now();
    const base = normalizeBase(config.endpoint || "");

    try {
      // Seedance（视频）保留旧探测路径
      if (config.provider === "seedance") {
        const res = await fetch(
          `https://ark.ap-southeast.bytepluses.com/api/v3/models`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        return {
          success: res.ok,
          status: res.status,
          latencyMs: Date.now() - startMs,
        };
      }

      // 新 provider 用统一探测：GET /models
      let url: string;
      let headers: Record<string, string>;
      if (config.provider === "azure_openai") {
        const ver = config.apiVersion || "2024-08-01-preview";
        url = `${base}/openai/models?api-version=${ver}`;
        headers = { "api-key": apiKey };
      } else if (config.provider === "google" || config.provider === "gemini") {
        const cleanBase = base.replace(/\/openai$/, "");
        // 双兼容：优先 OpenAI 兼容端点，失败时调用方可手动用原生 ?key=
        url = `${cleanBase}/openai/models`;
        headers = { Authorization: `Bearer ${apiKey}` };
      } else {
        // openai / custom
        url = `${base}/models`;
        headers = { Authorization: `Bearer ${apiKey}` };
      }

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
          success: false,
          status: res.status,
          latencyMs,
          error: text.slice(0, 300) || `HTTP ${res.status}`,
        };
      }
      return { success: true, status: res.status, latencyMs };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : "连接失败",
      };
    }
  });
}
