import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireRole } from "../../common/guards/rbac.js";
import { encrypt, decrypt, maskApiKey } from "../../common/crypto.js";
import { createAuditLog } from "../../common/audit.js";

const updateSchema = z.object({
  value: z.string().min(1),
  encrypted: z.boolean().optional(),
  remark: z.string().optional(),
});

export async function globalConfigRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async () => {
    const configs = await prisma.globalConfig.findMany({ orderBy: { key: "asc" } });
    return configs.map((c) => {
      if (!c.value) return { ...c, value: "" };
      if (c.encrypted) {
        try {
          return { ...c, value: maskApiKey(decrypt(c.value)) };
        } catch {
          return { ...c, value: "(未设置)" };
        }
      }
      return c;
    });
  });

  app.patch("/:key", { preHandler: [requireRole("SUPER_ADMIN")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const shouldEncrypt = parsed.data.encrypted ?? false;
    const storedValue = shouldEncrypt ? encrypt(parsed.data.value) : parsed.data.value;

    const config = await prisma.globalConfig.upsert({
      where: { key },
      update: {
        value: storedValue,
        encrypted: shouldEncrypt,
        remark: parsed.data.remark,
      },
      create: {
        key,
        value: storedValue,
        encrypted: shouldEncrypt,
        remark: parsed.data.remark,
      },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "global_config.update",
      targetType: "GlobalConfig",
      targetId: key,
      after: { key, encrypted: shouldEncrypt },
      ip: request.ip,
    });

    return {
      ...config,
      value: config.encrypted ? maskApiKey(decrypt(config.value)) : config.value,
    };
  });
}
