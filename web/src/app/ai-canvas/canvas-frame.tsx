"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type CanvasFrameProps = {
  projectId?: string;
};

export function CanvasFrame({ projectId }: CanvasFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const router = useRouter();

  const iframeSrc = useMemo(() => {
    if (!projectId) return "/canvas/";
    return `/canvas/edit/${encodeURIComponent(projectId)}`;
  }, [projectId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "creator-mmfc:canvas:back") {
        const target = typeof data.target === "string" && data.target.startsWith("/")
          ? data.target
          : "/dashboard";
        router.push(target);
        return;
      }

      if (data.type === "creator-mmfc:canvas:route") {
        const nextProjectId = typeof data.projectId === "string" ? data.projectId : "";
        const target = nextProjectId ? `/ai-canvas/${encodeURIComponent(nextProjectId)}` : "/ai-canvas";
        if (window.location.pathname !== target) {
          window.history.replaceState(null, "", target);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [router]);

  return (
    <div className="h-[calc(100vh-56px)] w-full bg-background">
      <iframe
        ref={iframeRef}
        title="MMFC Canvas"
        src={iframeSrc}
        className="h-full w-full border-0"
      />
    </div>
  );
}
