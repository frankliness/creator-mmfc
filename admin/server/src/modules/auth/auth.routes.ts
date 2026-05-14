import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash, compare } from "bcryptjs";
import { prisma } from "../../common/prisma.js";
import { requireLogin } from "../../common/guards/permission.js";
import { normalizePermissions } from "../../common/permissions/sections.js";

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
    const admin = await prisma.adminUser.findFirst({
      where: { username, deletedAt: null },
    });

    // 软删除账号、禁用账号、密码错误统一返回相同提示，避免账号探测
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
        isActive: admin.isActive,
        permissions: normalizePermissions(admin.permissions ?? {}),
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

      const admin = await prisma.adminUser.findFirst({
        where: { id: decoded.id, deletedAt: null },
      });
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

  app.get("/profile", { preHandler: [requireLogin()] }, async (request) => {
    const admin = request.adminUser!;
    // requireLogin 已加载 admin 实时状态并规范化 permissions；这里直接返回。
    // 仍读一次 DB 以补全 lastLoginAt / createdAt（不在守卫上下文中）。
    const extra = await prisma.adminUser.findUnique({
      where: { id: admin.id },
      select: { lastLoginAt: true, createdAt: true },
    });
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      isActive: admin.isActive,
      permissions: admin.permissions,
      lastLoginAt: extra?.lastLoginAt ?? null,
      createdAt: extra?.createdAt ?? null,
    };
  });

  app.patch("/password", { preHandler: [requireLogin()] }, async (request, reply) => {
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
