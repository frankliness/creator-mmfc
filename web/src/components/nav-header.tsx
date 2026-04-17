"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function NavHeader() {
  const { data: session } = useSession();

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/dashboard" className="text-lg font-bold">
          Seedance Studio
        </Link>
        <div className="flex items-center gap-4">
          {session?.user && (
            <>
              <span className="text-sm text-muted-foreground">
                {session.user.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                退出
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
