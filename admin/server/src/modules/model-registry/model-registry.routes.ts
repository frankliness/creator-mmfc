import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { createAuditLog } from "../../common/audit.js";

const CATEGORIES = ["chat", "canvas_image", "canvas_image_edit", "storyboard"] as const;
const PROVIDER_TYPES = ["openai", "azure_openai", "google", "custom"] as const;

const baseFields = z.object({
  modelKey: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(CATEGORIES),
  providers: z.array(z.enum(PROVIDER_TYPES)).min(1),
  capabilities: z.record(z.string(), z.unknown()),
  sizes: z.array(z.string()).optional().nullable(),
  qualities: z
    .array(z.object({ label: z.string(), key: z.string() }))
    .optional()
    .nullable(),
  defaultParams: z.record(z.string(), z.string()).optional().nullable(),
  tips: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
});

const createSchema = baseFields;
const updateSchema = baseFields.partial();

export async function modelRegistryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (request) => {
    const { category } = request.query as { category?: string };
    const where: Record<string, unknown> = {};
    if (category && (CATEGORIES as readonly string[]).includes(category)) {
      where.category = category;
    }
    return prisma.modelRegistry.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await prisma.modelRegistry.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: "模型不存在" });
    return item;
  });

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const conflict = await prisma.modelRegistry.findUnique({
      where: {
        modelKey_category: { modelKey: parsed.data.modelKey, category: parsed.data.category },
      },
    });
    if (conflict) {
      return reply
        .code(409)
        .send({ error: `(modelKey=${parsed.data.modelKey}, category=${parsed.data.category}) 已存在` });
    }

    const created = await prisma.modelRegistry.create({
      data: {
        modelKey: parsed.data.modelKey,
        label: parsed.data.label,
        category: parsed.data.category,
        providers: parsed.data.providers as unknown as object,
        capabilities: parsed.data.capabilities as unknown as object,
        sizes: (parsed.data.sizes ?? undefined) as unknown as object | undefined,
        qualities: (parsed.data.qualities ?? undefined) as unknown as object | undefined,
        defaultParams: (parsed.data.defaultParams ?? undefined) as unknown as object | undefined,
        tips: parsed.data.tips ?? undefined,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "model_registry.create",
      targetType: "ModelRegistry",
      targetId: created.id,
      after: { modelKey: created.modelKey, category: created.category, label: created.label },
      ip: request.ip,
    });

    return created;
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    const existing = await prisma.modelRegistry.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "模型不存在" });

    const data: Record<string, unknown> = {};
    for (const k of [
      "modelKey",
      "label",
      "category",
      "providers",
      "capabilities",
      "sizes",
      "qualities",
      "defaultParams",
      "tips",
      "isActive",
      "sortOrder",
    ] as const) {
      if (parsed.data[k] !== undefined) data[k] = parsed.data[k];
    }

    const updated = await prisma.modelRegistry.update({ where: { id }, data });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "model_registry.update",
      targetType: "ModelRegistry",
      targetId: id,
      before: { modelKey: existing.modelKey, category: existing.category },
      after: data,
      ip: request.ip,
    });

    return updated;
  });

  app.patch("/:id/toggle", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.modelRegistry.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "模型不存在" });

    const updated = await prisma.modelRegistry.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "model_registry.toggle",
      targetType: "ModelRegistry",
      targetId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      ip: request.ip,
    });

    return updated;
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.modelRegistry.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "模型不存在" });

    await prisma.modelRegistry.delete({ where: { id } });

    const admin = request.user as { id: string };
    await createAuditLog({
      adminId: admin.id,
      action: "model_registry.delete",
      targetType: "ModelRegistry",
      targetId: id,
      before: { modelKey: existing.modelKey, category: existing.category },
      ip: request.ip,
    });

    return { message: "已删除" };
  });
}
