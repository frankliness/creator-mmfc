import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NavHeader } from "@/components/nav-header";

/**
 * AI 画布壳层布局（URL `/ai-canvas`）：放在 (app) 路由组之外，避免继承默认 max-w-7xl 限宽。
 * 静态 Vue SPA 独占 `/canvas/*`，勿在此处占用 `/canvas`。
 * 同样要校验 NextAuth 会话，未登录跳 /login。
 */
export default async function CanvasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <NavHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
