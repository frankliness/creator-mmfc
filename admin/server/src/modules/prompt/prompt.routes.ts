import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../common/prisma.js";
import { requireAuth, requireRole } from "../../common/guards/rbac.js";
import { createAuditLog } from "../../common/audit.js";

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  category: z.enum(["SYSTEM_PROMPT", "JSON_SCHEMA", "USER_PROMPT"]),
  description: z.string().optional(),
  content: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  content: z.string().min(1).optional(),
  changeNote: z.string().optional(),
});

export async function promptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth());

  app.get("/", async () => {
    return prisma.promptTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, name: true, slug: true, category: true,
        description: true, version: true, isActive: true,
        createdAt: true, updatedAt: true,
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
    if (!parsed.success) return reply.code(400).send({ error: "参数错误", details: parsed.error.flatten() });

    if (parsed.data.category === "JSON_SCHEMA") {
      try { JSON.parse(parsed.data.content); } catch {
        return reply.code(400).send({ error: "JSON Schema 内容格式错误" });
      }
    }

    const existing = await prisma.promptTemplate.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) return reply.code(409).send({ error: "slug 已存在" });

    const admin = request.user as { id: string };

    const template = await prisma.promptTemplate.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        category: parsed.data.category,
        description: parsed.data.description,
        content: parsed.data.content,
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
      after: { slug: parsed.data.slug, category: parsed.data.category },
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
      try { JSON.parse(parsed.data.content); } catch {
        return reply.code(400).send({ error: "JSON Schema 内容格式错误" });
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
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
}
