"use client";

import { useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";

let fetchPatched = false;

function patchFetchForAuthRedirect() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    if (res.status === 401) {
      try {
        const reqUrl =
          typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : (args[0] as Request).url;
        const url = new URL(reqUrl, window.location.origin);
        const sameOrigin = url.origin === window.location.origin;
        const isApi = url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth");
        if (sameOrigin && isApi) {
          signOut({ callbackUrl: "/login" });
        }
      } catch {
        /* ignore */
      }
    }
    return res;
  };
}

export function SessionGuard() {
  const { status } = useSession();
  const prevStatus = useRef<typeof status | null>(null);

  useEffect(() => {
    patchFetchForAuthRedirect();
  }, []);

  useEffect(() => {
    if (
      prevStatus.current === "authenticated" &&
      status === "unauthenticated" &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      signOut({ callbackUrl: "/login" });
    }
    prevStatus.current = status;
  }, [status]);

  return null;
}
