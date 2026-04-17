import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash, compare } from "bcryptjs";
import { prisma } from "../../common/prisma.js";
import { requireAuth } from "../../common/guards/rbac.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const { username, password } = parsed.data;
    const admin = await prisma.adminUser.findUnique({ where: { username } });

    if (!admin || !admin.isActive) {
      return reply.code(401).send({ error: "用户名或密码错误" });
    }

    const valid = await compare(password, admin.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "用户名或密码错误" });
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = app.jwt.sign(
      { id: admin.id, role: admin.role },
      { expiresIn: "2h" }
    );
    const refreshToken = app.jwt.sign(
      { id: admin.id, type: "refresh" },
      { expiresIn: "7d" }
    );

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
      },
    };
  });

  app.post("/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (!body?.refreshToken) {
      return reply.code(400).send({ error: "缺少 refreshToken" });
    }

    try {
      const decoded = app.jwt.verify<{ id: string; type: string }>(body.refreshToken);
      if (decoded.type !== "refresh") {
        return reply.code(401).send({ error: "无效的 token 类型" });
      }

      const admin = await prisma.adminUser.findUnique({ where: { id: decoded.id } });
      if (!admin || !admin.isActive) {
        return reply.code(401).send({ error: "账号不存在或已禁用" });
      }

      const accessToken = app.jwt.sign(
        { id: admin.id, role: admin.role },
        { expiresIn: "2h" }
      );

      return { accessToken };
    } catch {
      return reply.code(401).send({ error: "refreshToken 已过期" });
    }
  });

  app.get("/profile", { preHandler: [requireAuth()] }, async (request) => {
    const { id } = request.user as { id: string };
    const admin = await prisma.adminUser.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return admin;
  });

  app.patch("/password", { preHandler: [requireAuth()] }, async (request, reply) => {
    const { id } = request.user as { id: string };
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "参数错误" });

    const admin = await prisma.adminUser.findUnique({ where: { id } });
    if (!admin) return reply.code(404).send({ error: "账号不存在" });

    const valid = await compare(parsed.data.oldPassword, admin.passwordHash);
    if (!valid) return reply.code(400).send({ error: "原密码错误" });

    const passwordHash = await hash(parsed.data.newPassword, 12);
    await prisma.adminUser.update({ where: { id }, data: { passwordHash } });

    return { message: "密码修改成功" };
  });
}
