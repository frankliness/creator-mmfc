import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { logUserAction } from "./user-action-logger";

function newSessionId(): string {
  return randomBytes(16).toString("hex");
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user) return null;

        if (user.status !== "ACTIVE") return null;

        const valid = await compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        // v1.9.1: 生成新 sessionId 并落库；旧 token 因 sid 不一致下次校验时失效（互踢）
        const sid = newSessionId();
        await prisma.user.update({
          where: { id: user.id },
          data: { activeSessionId: sid },
        });

        await logUserAction({
          userId: user.id,
          category: "auth",
          action: "auth.login",
          targetType: "User",
          targetId: user.id,
          route: "/api/auth/[...nextauth]",
          metadata: {
            email: user.email,
            sessionId: sid,
          },
        });

        // 把 sid 通过 user 传给 jwt callback
        return { id: user.id, email: user.email, name: user.name, sid } as {
          id: string;
          email: string;
          name: string;
          sid: string;
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // 登录时把 sid 写入 token
      if (user) {
        token.id = (user as { id: string }).id;
        const sid = (user as { sid?: string }).sid;
        if (sid) token.sid = sid;
      }

      // 客户端 useSession().update() 触发：从 DB 重读最新昵称，避免客户端伪造其他字段
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { name: true },
        });
        if (fresh) token.name = fresh.name;
        // 兼容前端直接传 name 的情形（DB 也已通过 PATCH /api/auth/me 写入）
        if (session && typeof (session as { name?: unknown }).name === "string") {
          token.name = (session as { name: string }).name;
        }
      }

      // 每次请求校验 token.sid 是否仍是 User.activeSessionId；不一致 -> 失效（另一会话登录踢掉此 token）
      if (token.id && token.sid) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { activeSessionId: true, status: true },
        });
        if (!dbUser || dbUser.status !== "ACTIVE" || dbUser.activeSessionId !== token.sid) {
          // 返回空 token 让 session callback 视为未登录
          return {};
        }
      }
      return token;
    },
    session({ session, token }) {
      if (!token?.id) {
        // jwt 已 invalidate；让客户端视为未登录
        return null as unknown as typeof session;
      }
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
