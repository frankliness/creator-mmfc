import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 已登录且账户处于 ACTIVE 的会话用户上下文。 */
export interface CanvasSessionUser {
  id: string;
  email: string;
  name: string;
}

export type RequireResult =
  | { ok: true; user: CanvasSessionUser }
  | { ok: false; status: 401 | 403; error: string };

/**
 * 画布所有 API 的统一鉴权入口：
 *   - 未登录 → 401
 *   - 用户被管理员置为 SUSPENDED/DISABLED → 403（即使 NextAuth session 还没过期也立即失效）
 */
export async function requireCanvasUser(): Promise<RequireResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: "未登录" };
  }

  // 必须实时校验 status，避免 admin 封禁后用户仍能用画布
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, status: true },
  });

  if (!user) {
    return { ok: false, status: 401, error: "账户不存在" };
  }
  if (user.status !== "ACTIVE") {
    return { ok: false, status: 403, error: `账户已被${user.status === "SUSPENDED" ? "暂停" : "禁用"}` };
  }

  return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
}

/** 统一错误响应格式。 */
export function authError(result: Extract<RequireResult, { ok: false }>): Response {
  return Response.json({ error: result.error }, { status: result.status });
}
