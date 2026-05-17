/**
 * v1.9.0 工作台 API 守卫。包裹 NextAuth session + Series 成员检查，简化路由代码。
 */
import { NextResponse } from "next/server";
import { auth } from "./auth";
import {
  SeriesAccessError,
  assertSeriesMember,
  type MemberRole,
} from "./series-membership";

export type WorkspaceUser = { id: string; email?: string | null; name?: string | null };

/** 取登录用户。无 session 返回 NextResponse(401)。 */
export async function requireUser(): Promise<WorkspaceUser | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

/** 包裹路由 handler，自动处理 SeriesAccessError → 对应 status。 */
export function withSeriesGuard<TArgs extends unknown[], R>(
  fn: (...args: TArgs) => Promise<R>,
): (...args: TArgs) => Promise<R | NextResponse> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof SeriesAccessError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status },
        );
      }
      throw err;
    }
  };
}

/** 一次性取 user + 校验 Series 成员。 */
export async function requireSeriesMember(
  seriesId: string,
  requiredRoles?: MemberRole[],
): Promise<{ user: WorkspaceUser; role: MemberRole } | NextResponse> {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  try {
    const { role } = await assertSeriesMember(userOrResponse.id, seriesId, requiredRoles);
    return { user: userOrResponse, role };
  } catch (err) {
    if (err instanceof SeriesAccessError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
}
