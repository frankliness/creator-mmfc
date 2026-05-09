import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { encrypt, decrypt } from "../../common/crypto.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { createAuditLog } from "../../common/audit.js";

const PROVIDER_TYPES = ["openai", "azure_openai", "google", "custom"] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];
const PURPOSES = ["chat", "storyboard", "canvas_image", "canvas_image_edit"] as const;
type Purpose = (typeof PURPOSES)[number];

/** 与 web/src/lib/llm/config-resolver.ts 同款的 base 归一化。 */
function normalizeBase(url: string): string {
  let result = (url || "").trim().replace(/\/+$/, "");
  const suffixes = [
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
  for (const s of suffixes) {
    if (result.endsWith(s)) {
      result = result.slice(0, -s.length);
      break;
    }
  }
  result = result.replace(/\/openai$/, "");
  return result;
}

const createSchema = z.object({
  provider: z.enum(PROVIDER_TYPES),
  name: z.string().min(1).max(100),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1), // 明文，路由内加密
  deployment: z.string().optional().nullable(),
  apiVersion: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  purposes: z.array(z.enum(PURPOSES)).min(1).default([...PURPOSES]),
  modelKeys: z.array(z.string().min(1)).optional().nullable(),
  isPrimary: z.boolean().default(false),
  sortOrder: z.number().int().default(100),
  remark: z.string().optional().nullable(),
});

const updateSchema = createSchema
  .partial()
  // apiKey 留空 = 不修改
  .extend({
    apiKey: z.string().optional(),
  });

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return list.length > 0 ? list : null;
}

function credentialPurposes(value: unknown): string[] {
  return readStringArray(value) ?? [...PURPOSES];
}

function scopesOverlap(a: string[] | null, b: string[] | null): boolean {
  if (!a || !b) return true;
  return a.some((item) => b.includes(item));
}

function modelKeysInput(modelKeys: string[] | null | undefined) {
  return modelKeys && modelKeys.length > 0 ? modelKeys : Prisma.DbNull;
}

/** 同 provider + purpose + modelKey 范围下只允许一条 isPrimary=true。 */
async function ensureSinglePrimary(
  provider: ProviderType,
  purposes: Purpose[],
  modelKeys: string[] | null,
  exceptId?: string
) {
  const where: Record<string, unknown> = { provider, isPrimary: true };
  if (exceptId) where.id = { not: exceptId };
  const existing = await prisma.providerCredential.findMany({
    where: where as never,
  });
  const ids = existing
    .filter((cred) => {
      const credPurposes = credentialPurposes(cred.purposes);
      const credModelKeys = readStringArray(cred.modelKeys);
      return scopesOverlap(credPurposes, purposes) && scopesOverlap(credModelKeys, modelKeys);
    })
    .map((cred) => cred.id);
  if (ids.length === 0) return;

  await prisma.providerCredential.updateMany({
    where: { id: { in: ids } },
    data: { isPrimary: false },
  });
}

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  provider: string;
  modelsCount?: number;
}

async function probe(config: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  deployment?: string | null;
  apiVersion?: string | null;
}): Promise<ProbeResult> {
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
      url = `${base}/models`;
      headers = { Authorization: `Bearer ${config.apiKey}` };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
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
      /* ignore */
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

/** 把 DB 行映射到 API 响应（mask apiKey） */
function toApi(cred: {
  id: string;
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  deployment: string | null;
  apiVersion: string | null;
  isActive: boolean;
  purposes: unknown;
  modelKeys: unknown;
  isPrimary: boolean;
  sortOrder: number;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  // mask: 头 4 + ****** + 尾 4
  const k = cred.apiKey;
  const masked = k.length <= 12 ? "********" : `${k.slice(0, 4)}******${k.slice(-4)}`;
  return {
    id: cred.id,
    provider: cred.provider,
    name: cred.name,
    baseUrl: cred.baseUrl,
    apiKeyMasked: masked,
    deployment: cred.deployment,
    apiVersion: cred.apiVersion,
    isActive: cred.isActive,
    purposes: credentialPurposes(cred.purposes),
    modelKeys: readStringArray(cred.modelKeys) ?? [],
    isPrimary: cred.isPrimary,
    sortOrder: cred.sortOrder,
    remark: cred.remark,
    createdAt: cred.createdAt,
    updatedAt: cred.updatedAt,
  };
}

export async function credentialsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const { provider } = request.query as { provider?: string };
    const where: Record<string, unknown> = {};
    if (provider && (PROVIDER_TYPES as readonly string[]).includes(provider)) {
      where.provider = provider;
    }
    const list = await prisma.providerCredential.findMany({
      where,
      orderBy: [{ provider: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return list.map(toApi);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await prisma.providerCredential.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: "凭据不存在" });
    return toApi(item);
  });

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });
    }

    const data = parsed.data;
    if (data.isPrimary) {
      await ensureSinglePrimary(
        data.provider,
        data.purposes,
        data.modelKeys && data.modelKeys.length > 0 ? data.modelKeys : null
      );
    }

    const created = await prisma.providerCredential.create({
      data: {
        provider: data.provider,
        name: data.name,
        baseUrl: normalizeBase(data.baseUrl),
        apiKey: encrypt(data.apiKey),
        deployment: data.deployment ?? null,
        apiVersion: data.apiVersion ?? null,
        isActive: data.isActive,
        purposes: data.purposes,
        modelKeys: modelKeysInput(data.modelKeys),
        isPrimary: data.isPrimary,
        sortOrder: data.sortOrder,
        remark: data.remark ?? null,
      },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "credential.create",
      targetType: "ProviderCredential",
      targetId: created.id,
      after: {
        provider: created.provider,
        name: created.name,
        purposes: created.purposes,
        modelKeys: created.modelKeys,
        isPrimary: created.isPrimary,
      },
      ip: request.ip,
    });

    return toApi(created);
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });
    }

    const existing = await prisma.providerCredential.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "凭据不存在" });

    const d = parsed.data;
    const data: Record<string, unknown> = {};

    if (d.provider !== undefined) data.provider = d.provider;
    if (d.name !== undefined) data.name = d.name;
    if (d.baseUrl !== undefined) data.baseUrl = normalizeBase(d.baseUrl);
    if (d.apiKey !== undefined && d.apiKey.trim() !== "") data.apiKey = encrypt(d.apiKey);
    if (d.deployment !== undefined) data.deployment = d.deployment;
    if (d.apiVersion !== undefined) data.apiVersion = d.apiVersion;
    if (d.isActive !== undefined) data.isActive = d.isActive;
    if (d.purposes !== undefined) data.purposes = d.purposes;
    if (d.modelKeys !== undefined) {
      data.modelKeys = modelKeysInput(d.modelKeys);
    }
    if (d.sortOrder !== undefined) data.sortOrder = d.sortOrder;
    if (d.remark !== undefined) data.remark = d.remark;

    const nextProvider = (d.provider ?? existing.provider) as ProviderType;
    const nextPurposes = (d.purposes ?? credentialPurposes(existing.purposes)) as Purpose[];
    const nextModelKeys =
      d.modelKeys !== undefined ? (d.modelKeys && d.modelKeys.length > 0 ? d.modelKeys : null) : readStringArray(existing.modelKeys);
    const nextIsPrimary = d.isPrimary ?? existing.isPrimary;

    if (d.isPrimary !== undefined) {
      data.isPrimary = d.isPrimary;
    }

    if (nextIsPrimary) {
      await ensureSinglePrimary(nextProvider, nextPurposes, nextModelKeys, id);
    }

    const updated = await prisma.providerCredential.update({ where: { id }, data });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "credential.update",
      targetType: "ProviderCredential",
      targetId: id,
      before: {
        name: existing.name,
        purposes: existing.purposes,
        modelKeys: existing.modelKeys,
        isPrimary: existing.isPrimary,
        isActive: existing.isActive,
      },
      after: data,
      ip: request.ip,
    });

    return toApi(updated);
  });

  app.patch("/:id/toggle", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.providerCredential.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "凭据不存在" });

    const updated = await prisma.providerCredential.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "credential.toggle",
      targetType: "ProviderCredential",
      targetId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      ip: request.ip,
    });

    return toApi(updated);
  });

  app.patch("/:id/set-primary", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.providerCredential.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "凭据不存在" });

    await ensureSinglePrimary(
      existing.provider as ProviderType,
      credentialPurposes(existing.purposes) as Purpose[],
      readStringArray(existing.modelKeys),
      id
    );
    const updated = await prisma.providerCredential.update({
      where: { id },
      data: { isPrimary: true },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "credential.set-primary",
      targetType: "ProviderCredential",
      targetId: id,
      after: {
        provider: updated.provider,
        purposes: updated.purposes,
        modelKeys: updated.modelKeys,
        isPrimary: true,
      },
      ip: request.ip,
    });

    return toApi(updated);
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.providerCredential.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "凭据不存在" });

    // 删除前先把所有引用此凭据的 UserApiConfig.credentialId 置 null（FK on delete = SetNull 已实现，这里冗余也无害）
    await prisma.providerCredential.delete({ where: { id } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "credential.delete",
      targetType: "ProviderCredential",
      targetId: id,
      before: { provider: existing.provider, name: existing.name },
      ip: request.ip,
    });

    return { message: "已删除" };
  });

  app.post("/:id/test", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.providerCredential.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "凭据不存在" });

    let plain: string;
    try {
      plain = decrypt(existing.apiKey);
    } catch {
      return reply.code(500).send({ ok: false, error: "凭据解密失败" });
    }

    return probe({
      provider: existing.provider,
      baseUrl: existing.baseUrl,
      apiKey: plain,
      deployment: existing.deployment,
      apiVersion: existing.apiVersion,
    });
  });
}
