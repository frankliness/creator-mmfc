import type { FastifyRequest, FastifyReply } from "fastify";

type Role = "SUPER_ADMIN" | "ADMIN" | "OPERATOR";

const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 3,
  ADMIN: 2,
  OPERATOR: 1,
};

export function requireRole(minRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "未认证" });
    }

    const user = request.user as { id: string; role: Role };
    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole];

    if (userLevel < requiredLevel) {
      return reply.code(403).send({ error: "权限不足" });
    }
  };
}

export function requireAuth() {
  return requireRole("OPERATOR");
}
