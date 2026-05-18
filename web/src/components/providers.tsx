"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import { SessionGuard } from "@/components/session-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={30} refetchOnWindowFocus>
      <SessionGuard />
      {children}
      <Toaster richColors position="top-right" />
    </SessionProvider>
  );
}
