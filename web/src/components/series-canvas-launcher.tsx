"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";

interface CanvasProject {
  id: string;
  name: string;
  thumbnail?: string | null;
  status: string;
  seriesId: string | null;
  updatedAt: string;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return date.toLocaleDateString("zh-CN");
}

export function SeriesCanvasLauncher({ seriesId, readOnly = false }: { seriesId: string; readOnly?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/canvas/projects?seriesId=${encodeURIComponent(seriesId)}`)
      .then((r) => r.json())
      .then((data: CanvasProject[]) => {
        setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => {/* silently ignore */})
      .finally(() => setLoading(false));
  }, [seriesId]);

  async function onCreate() {
    if (!name.trim()) return toast.error("请输入画布名称");
    setCreating(true);
    try {
      const res = await fetch("/api/canvas/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), seriesId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "创建失败");
      }
      const data = await res.json();
      toast.success("画布已创建");
      router.push(`/ai-canvas/${data.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Canvas 画布</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing canvases */}
        {loading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-col overflow-hidden rounded-md border bg-muted/30"
              >
                {/* Thumbnail */}
                <div className="flex h-20 items-center justify-center bg-muted">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnail}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                {/* Info + action */}
                <div className="flex flex-col gap-1 p-2">
                  <p className="truncate text-sm font-medium" title={p.name}>
                    {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(p.updatedAt)}
                  </p>
                  <Link href={`/ai-canvas/${p.id}`}>
                    <Button size="sm" variant="outline" className="mt-1 w-full text-xs">
                      进入画布
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Create new canvas form */}
        {!readOnly ? (
          <div>
            <div className="flex gap-2">
              <Input
                placeholder="画布名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
              <Button onClick={onCreate} disabled={creating || !name.trim()}>
                创建画布
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              画布自动绑定到本 Series，生图调用走项目预算池。
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">👁 只读模式：可查看画布，不可创建。</p>
        )}
      </CardContent>
    </Card>
  );
}
