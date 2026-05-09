import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { createAuditLog } from "../../common/audit.js";
import { decrypt } from "../../common/crypto.js";

const PROVIDER_TYPES = ["openai", "azure_openai", "google", "custom"] as const;

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  category: z.enum(["SYSTEM_PROMPT", "JSON_SCHEMA", "USER_PROMPT"]),
  description: z.string().optional(),
  content: z.string().min(1),
  /** null/undefined/[] = 通用条目；["openai", ...] = 仅适用列表中的 provider */
  applicableProviders: z.array(z.enum(PROVIDER_TYPES)).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  content: z.string().min(1).optional(),
  changeNote: z.string().optional(),
  applicableProviders: z.array(z.enum(PROVIDER_TYPES)).nullable().optional(),
});

/** 与 connection-test 同款 base URL 归一化 */
function normalizeBase(url: string): string {
  let result = (url || "").trim().replace(/\/+$/, "");
  const endpointSuffixes = [
    "/chat/completions",
    "/images/generations",
    "/images/edits",
    "/embeddings",
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

interface SchemaTestBody {
  schema: unknown;
  purpose: "storyboard";
  sampleScript?: string;
}

const schemaTestSchema = z.object({
  schema: z.unknown(),
  purpose: z.literal("storyboard"),
  sampleScript: z.string().optional(),
});

export async function promptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async () => {
    return prisma.promptTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        applicableProviders: true,
        version: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await prisma.promptTemplate.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: "desc" }, take: 10 },
      },
    });
    if (!template) return reply.code(404).send({ error: "模板不存在" });
    return template;
  });

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    if (parsed.data.category === "JSON_SCHEMA") {
      try {
        JSON.parse(parsed.data.content);
      } catch {
        return reply.code(400).send({ error: "JSON Schema 内容格式错误" });
      }
    }

    // 不再要求 slug 全局唯一；但若新建条目与现有条目的 (slug, applicableProviders) 完全重叠则拒绝，
    // 避免 admin 不小心创建两条完全相同覆盖范围的条目导致歧义
    const conflictCandidates = await prisma.promptTemplate.findMany({
      where: { slug: parsed.data.slug },
    });
    const newProviders = parsed.data.applicableProviders ?? null;
    const overlap = conflictCandidates.find((c) => {
      const list = (c.applicableProviders as string[] | null) ?? null;
      // 同为通用
      if (list === null && newProviders === null) return true;
      if (Array.isArray(list) && Array.isArray(newProviders)) {
        return list.some((p) => (newProviders as string[]).includes(p));
      }
      return false;
    });
    if (overlap) {
      return reply
        .code(409)
        .send({ error: `已存在 slug=${parsed.data.slug} 且 applicableProviders 范围重叠的条目（id=${overlap.id}）` });
    }

    const admin = request.user as { id: string };

    const template = await prisma.promptTemplate.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        category: parsed.data.category,
        description: parsed.data.description,
        content: parsed.data.content,
        applicableProviders:
          newProviders === null || newProviders === undefined ? undefined : newProviders,
        version: 1,
        versions: {
          create: {
            version: 1,
            content: parsed.data.content,
            changeNote: "初始版本",
            createdBy: admin.id,
          },
        },
      },
    });

    await createAuditLog({
      adminId: admin.id,
      action: "prompt.create",
      targetType: "PromptTemplate",
      targetId: template.id,
      after: {
        slug: parsed.data.slug,
        category: parsed.data.category,
        applicableProviders: newProviders,
      },
      ip: request.ip,
    });

    return template;
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const existing = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "模板不存在" });

    if (parsed.data.content && existing.category === "JSON_SCHEMA") {
      try {
        JSON.parse(parsed.data.content);
      } catch {
        return reply.code(400).send({ error: "JSON Schema 内容格式错误" });
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.applicableProviders !== undefined) {
      data.applicableProviders = parsed.data.applicableProviders;
    }
    if (parsed.data.content) {
      const newVersion = existing.version + 1;
      data.content = parsed.data.content;
      data.version = newVersion;

      const admin = request.user as { id: string };
      await prisma.promptVersion.create({
        data: {
          templateId: id,
          version: newVersion,
          content: parsed.data.content,
          changeNote: parsed.data.changeNote,
          createdBy: admin.id,
        },
      });
    }

    const updated = await prisma.promptTemplate.update({ where: { id }, data });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "prompt.update",
      targetType: "PromptTemplate",
      targetId: id,
      before: { version: existing.version },
      after: data,
      ip: request.ip,
    });

    return updated;
  });

  app.post("/:id/publish", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!template) return reply.code(404).send({ error: "模板不存在" });

    await prisma.promptTemplate.update({ where: { id }, data: { isActive: true } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "prompt.publish",
      targetType: "PromptTemplate",
      targetId: id,
      after: { slug: template.slug, version: template.version },
      ip: request.ip,
    });

    return { message: "模板已发布" };
  });

  app.post("/:id/rollback/:version", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const versionNum = parseInt(version);

    const snapshot = await prisma.promptVersion.findUnique({
      where: { templateId_version: { templateId: id, version: versionNum } },
    });
    if (!snapshot) return reply.code(404).send({ error: "版本不存在" });

    const template = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!template) return reply.code(404).send({ error: "模板不存在" });

    const newVersion = template.version + 1;

    const admin = request.user as { id: string };
    await prisma.promptVersion.create({
      data: {
        templateId: id,
        version: newVersion,
        content: snapshot.content,
        changeNote: `回滚到 v${versionNum}`,
        createdBy: admin.id,
      },
    });

    await prisma.promptTemplate.update({
      where: { id },
      data: { content: snapshot.content, version: newVersion },
    });

    await createAuditLog({
      adminId: admin.id,
      action: "prompt.rollback",
      targetType: "PromptTemplate",
      targetId: id,
      after: { rollbackTo: versionNum, newVersion },
      ip: request.ip,
    });

    return { message: `已回滚到 v${versionNum}，当前版本 v${newVersion}` };
  });

  app.get("/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const versions = await prisma.promptVersion.findMany({
      where: { templateId: id },
      orderBy: { version: "desc" },
    });
    if (versions.length === 0) return reply.code(404).send({ error: "模板不存在" });
    return versions;
  });

  // ─────────────────────────────────────────────────────────────────
  // Schema 测试：用 storyboard 的 GlobalConfig 配置发一次最小请求验证 schema 可用 + 输出可解析
  // POST /api/admin/prompts/test-schema
  // Body: { schema, purpose: "storyboard", sampleScript? }
  // ─────────────────────────────────────────────────────────────────
  app.post("/test-schema", async (request, reply) => {
    const parsed = schemaTestSchema.safeParse(request.body as SchemaTestBody);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const purpose = parsed.data.purpose; // 当前只支持 storyboard
    const sampleScript =
      parsed.data.sampleScript ||
      "测试输入：单镜头，10 秒，主角站在公园中央，输出一个分镜即可。";

    // 读 storyboard 的 GlobalConfig 配置
    const keys = ["provider", "base_url", "api_key", "model", "deployment", "api_version"].map(
      (f) => `${purpose}_${f}`
    );
    const records = await prisma.globalConfig.findMany({ where: { key: { in: keys } } });
    const map = new Map(records.map((r) => [r.key, r]));

    const provider = map.get(`${purpose}_provider`)?.value;
    const baseRaw = map.get(`${purpose}_base_url`)?.value;
    const apiKeyRecord = map.get(`${purpose}_api_key`);
    const model = map.get(`${purpose}_model`)?.value;
    const deployment = map.get(`${purpose}_deployment`)?.value;
    const apiVersion = map.get(`${purpose}_api_version`)?.value;

    if (!provider || !baseRaw || !apiKeyRecord?.value || !model) {
      return reply.code(400).send({
        ok: false,
        error: `${purpose} 的 GlobalConfig 不完整（需 provider/base_url/api_key/model 全部填写）`,
      });
    }

    let apiKey: string;
    try {
      apiKey = apiKeyRecord.encrypted ? decrypt(apiKeyRecord.value) : apiKeyRecord.value;
    } catch {
      return reply.code(400).send({ ok: false, error: "api_key 解密失败" });
    }

    const base = normalizeBase(baseRaw);
    const startMs = Date.now();
    const schema = parsed.data.schema as object;

    let respText: string | null = null;
    let parsedOutput: unknown = null;
    let schemaValid = false;
    let errorMsg: string | undefined;

    try {
      if (provider === "google") {
        // Gemini 原生 generateContent + responseSchema
        const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: sampleScript }] }],
            generationConfig: {
              maxOutputTokens: 4096,
              temperature: 0.5,
              responseMimeType: "application/json",
              responseSchema: schema,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          errorMsg = `HTTP ${res.status}: ${t.slice(0, 400)}`;
        } else {
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          respText =
            data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || null;
        }
      } else {
        // OpenAI / Azure / Custom: response_format.json_schema
        let url: string;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (provider === "azure_openai") {
          const ver = apiVersion || "2024-08-01-preview";
          const dep = deployment || model;
          url = `${base}/openai/deployments/${encodeURIComponent(dep)}/chat/completions?api-version=${ver}`;
          headers["api-key"] = apiKey;
        } else {
          url = `${base}/chat/completions`;
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const body: Record<string, unknown> = {
          messages: [{ role: "user", content: sampleScript }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "schema_test", schema },
          },
          temperature: 0.5,
          max_tokens: 4096,
        };
        if (provider !== "azure_openai") body.model = model;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          errorMsg = `HTTP ${res.status}: ${t.slice(0, 400)}`;
        } else {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          respText = data.choices?.[0]?.message?.content || null;
        }
      }

      if (!errorMsg && respText) {
        try {
          parsedOutput = JSON.parse(respText);
          // 简单顶层校验：schema 顶层若是 object 且声明了 properties，检查实际响应顶层包含至少一个 property key
          const schemaProps =
            (schema as { properties?: Record<string, unknown> }).properties || {};
          const expectedKeys = Object.keys(schemaProps);
          if (expectedKeys.length === 0) {
            schemaValid = true; // 没声明 properties 就不强校验
          } else {
            const responseKeys =
              parsedOutput && typeof parsedOutput === "object"
                ? Object.keys(parsedOutput as Record<string, unknown>)
                : [];
            schemaValid = expectedKeys.some((k) => responseKeys.includes(k));
          }
        } catch (e) {
          errorMsg = `模型返回非 JSON 内容（解析失败）`;
        }
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : "请求失败";
    }

    return {
      ok: !errorMsg && schemaValid,
      latencyMs: Date.now() - startMs,
      providerUsed: provider,
      modelUsed: model,
      responseText: respText?.slice(0, 2000) ?? null,
      parsedOutput,
      schemaValid,
      error: errorMsg,
    };
  });
}
