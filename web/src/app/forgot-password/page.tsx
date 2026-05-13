"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleSendCode() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("请先填写有效邮箱");
      return;
    }
    setSendingCode(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "RESET_PASSWORD" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "验证码发送失败");
        return;
      }
      toast.success("如该邮箱已注册，验证码已发送");
      setCooldown(60);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        code: formData.get("code"),
        newPassword: formData.get("newPassword"),
      }),
    });

    setLoading(false);
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "重置失败");
      return;
    }

    toast.success("密码已重置，请用新密码登录");
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">重置密码</CardTitle>
          <CardDescription>通过邮箱验证码设置新密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">邮箱验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="6 位验证码"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={sendingCode || cooldown > 0}
                  className="shrink-0"
                >
                  {cooldown > 0
                    ? `${cooldown}s 后重发`
                    : sendingCode
                    ? "发送中..."
                    : "发送验证码"}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                placeholder="至少 6 位"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "提交中..." : "重置密码"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            想起来了？{" "}
            <Link href="/login" className="underline hover:text-foreground">
              返回登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
