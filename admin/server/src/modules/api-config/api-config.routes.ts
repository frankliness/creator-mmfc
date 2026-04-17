import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireRole } from "../../common/guards/rbac.js";
import { encrypt, decrypt, maskApiKey } from "../../common/crypto.js";
import { createAuditLog } from "../../common/audit.js";

const createSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().optional(),
  isDefault: z.boolean().default(false),
});

const updateSchema = createSchema.partial();

export async function apiConfigRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/users/:userId/api-configs", async (request) => {
    const { userId } = request.params as { userId: string };
    const configs = await prisma.userApiConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return configs.map((c) => ({
      ...c,
      apiKey: maskApiKey(decrypt(c.apiKey)),
    }));
  });

  app.post("/users/:userId/api-configs", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "用户不存在" });

    if (parsed.data.isDefault) {
      await prisma.userApiConfig.updateMany({
        where: { userId, provider: parsed.data.provider, isDefault: true },
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
        isDefault: parsed.data.isDefault,
      },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.create",
      targetType: "UserApiConfig",
      targetId: config.id,
      after: { userId, provider: parsed.data.provider, name: parsed.data.name },
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
    if (parsed.data.isDefault !== undefined) {
      if (parsed.data.isDefault) {
        await prisma.userApiConfig.updateMany({
          where: { userId, provider: existing.provider, isDefault: true, id: { not: configId } },
          data: { isDefault: false },
        });
      }
      data.isDefault = parsed.data.isDefault;
    }

    const updated = await prisma.userApiConfig.update({ where: { id: configId }, data });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.update",
      targetType: "UserApiConfig",
      targetId: configId,
      before: { provider: existing.provider, name: existing.name, endpoint: existing.endpoint },
      after: data,
      ip: request.ip,
    });

    return { ...updated, apiKey: maskApiKey(decrypt(updated.apiKey)) };
  });

  app.delete("/users/:userId/api-configs/:configId", async (request, reply) => {
    const { userId, configId } = request.params as { userId: string; configId: string };
    const existing = await prisma.userApiConfig.findFirst({ where: { id: configId, userId } });
    if (!existing) return reply.code(404).send({ error: "配置不存在" });

    await prisma.userApiConfig.delete({ where: { id: configId } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "api_config.delete",
      targetType: "UserApiConfig",
      targetId: configId,
      before: { provider: existing.provider, name: existing.name },
      ip: request.ip,
    });

    return { message: "配置已删除" };
  });

  app.post("/users/:userId/api-configs/:configId/test", async (request, reply) => {
    const { userId, configId } = request.params as { userId: string; configId: string };
    const config = await prisma.userApiConfig.findFirst({ where: { id: configId, userId } });
    if (!config) return reply.code(404).send({ error: "配置不存在" });

    const apiKey = decrypt(config.apiKey);

    try {
      if (config.provider === "seedance") {
        const res = await fetch(`https://ark.ap-southeast.bytepluses.com/api/v3/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { success: res.ok, status: res.status };
      }

      if (config.provider === "gemini") {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return { success: res.ok, status: res.status };
      }

      return { success: true, message: "未支持该 Provider 的连通性测试" };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "连接失败" };
    }
  });
}
