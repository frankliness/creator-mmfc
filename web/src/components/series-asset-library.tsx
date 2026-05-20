"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface SeriesAsset {
  id: string;
  name: string;
  type: "IMAGE" | "VIDEO" | "AUDIO";
  source: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  ossPublicUrl: string;
  byteplusAssetId: string | null;
  byteplusSyncStatus: string;
  byteplusSyncError: string | null;
  createdAt: string;
}

interface AssetsResponse {
  items: SeriesAsset[];
  page: number;
  size: number;
  total: number;
}

const fetcher = async (url: string): Promise<AssetsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("加载失败");
  return res.json();
};

const SOURCE_LABEL: Record<string, string> = {
  MANUAL_UPLOAD: "手动上传",
  CANVAS_GENERATED: "Canvas 生成",
  VIDEO_RESULT: "视频结果",
  VIDEO_TAIL_FRAME: "视频尾帧",
};

const SYNC_STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  NOT_SYNCED: { label: "未同步", variant: "outline" },
  SYNCING: { label: "同步中", variant: "default" },
  PROCESSING: { label: "处理中", variant: "default" },
  SYNCED: { label: "已同步", variant: "secondary" },
  FAILED: { label: "失败", variant: "destructive" },
};

export function SeriesAssetLibrary({
  seriesId,
  canWrite,
  groupActive,
}: {
  seriesId: string;
  canWrite: boolean;
  groupActive: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [syncFilter, setSyncFilter] = useState<string>("ALL");
  const [keyword, setKeyword] = useState("");

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (typeFilter !== "ALL") sp.set("type", typeFilter);
    if (sourceFilter !== "ALL") sp.set("source", sourceFilter);
    if (syncFilter !== "ALL") sp.set("syncStatus", syncFilter);
    if (keyword.trim()) sp.set("keyword", keyword.trim());
    sp.set("size", "100");
    return sp.toString();
  }, [typeFilter, sourceFilter, syncFilter, keyword]);

  const { data, mutate, isLoading } = useSWR<AssetsResponse>(
    `/api/workspace/series/${seriesId}/assets?${query}`,
    fetcher,
  );

  // 轮询：检测 SYNCING / PROCESSING 状态的资产，每 3s 调 refresh-byteplus
  const pendingIds = useMemo(
    () => (data?.items ?? []).filter((a) => a.byteplusSyncStatus === "SYNCING" || a.byteplusSyncStatus === "PROCESSING").map((a) => a.id),
    [data],
  );
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (pendingIds.length === 0) return;
    pollRef.current = setInterval(async () => {
      try {
        await Promise.all(
          pendingIds.map((id) =>
            fetch(`/api/workspace/series/${seriesId}/assets/${id}/refresh-byteplus`, {
              method: "POST",
            }).catch(() => undefined),
          ),
        );
        mutate();
      } catch {
        // ignore
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pendingIds, seriesId, mutate]);

  return (
    <div className="space-y-4">
      {canWrite && <UploadCard seriesId={seriesId} onUploaded={() => mutate()} groupActive={groupActive} />}

      <Card>
        <CardHeader>
          <CardTitle>资产列表 {data && <span className="text-sm text-muted-foreground">（{data.total}）</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">类型</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="IMAGE">图片</SelectItem>
                  <SelectItem value="VIDEO">视频</SelectItem>
                  <SelectItem value="AUDIO">音频</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">来源</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="MANUAL_UPLOAD">手动上传</SelectItem>
                  <SelectItem value="CANVAS_GENERATED">Canvas 生成</SelectItem>
                  <SelectItem value="VIDEO_RESULT">视频结果</SelectItem>
                  <SelectItem value="VIDEO_TAIL_FRAME">视频尾帧</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">同步状态</Label>
              <Select value={syncFilter} onValueChange={setSyncFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="SYNCED">已同步</SelectItem>
                  <SelectItem value="SYNCING">同步中</SelectItem>
                  <SelectItem value="PROCESSING">处理中</SelectItem>
                  <SelectItem value="NOT_SYNCED">未同步</SelectItem>
                  <SelectItem value="FAILED">失败</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">关键字</Label>
              <Input placeholder="按名称搜索" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => mutate()} disabled={isLoading}>
              刷新
            </Button>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
          {!isLoading && (data?.items.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">暂无资产</p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(data?.items ?? []).map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                seriesId={seriesId}
                canWrite={canWrite}
                groupActive={groupActive}
                onChanged={() => mutate()}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UploadCard({
  seriesId,
  onUploaded,
  groupActive,
}: {
  seriesId: string;
  onUploaded: () => void;
  groupActive: boolean;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onSubmit() {
    if (!file) return toast.error("请选择文件");
    const trimmed = name.trim();
    if (!trimmed) return toast.error("请填写资产名称");
    if (trimmed.length > 64) return toast.error("资产名称最大 64 字符");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", trimmed);
    setUploading(true);
    try {
      const res = await fetch(`/api/workspace/series/${seriesId}/assets`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "上传失败");
      toast.success(
        data.willSync ? "上传成功，正在同步 BytePlus" : "上传成功（未同步，Series 未绑定 Group）",
      );
      setName("");
      setFile(null);
      // 重置 file input
      const input = document.getElementById("series-asset-upload-input") as HTMLInputElement | null;
      if (input) input.value = "";
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>上传素材</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>资产名称（同 Series 全类型唯一，最大 64 字符）</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：伊莎贝拉、第3集场景" maxLength={64} />
          </div>
          <div>
            <Label>文件（图片 / 视频 / 音频）</Label>
            <Input
              id="series-asset-upload-input"
              type="file"
              accept="image/*,video/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        {!groupActive && (
          <p className="text-xs text-amber-600">
            ⚠ Series 未绑定有效 Asset Group，上传后资产仅保存到 OSS，不会同步到 BytePlus。
          </p>
        )}
        <Button onClick={onSubmit} disabled={uploading || !file || !name.trim()}>
          {uploading ? "上传中…" : "上传"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AssetCard({
  asset,
  seriesId,
  canWrite,
  groupActive,
  onChanged,
}: {
  asset: SeriesAsset;
  seriesId: string;
  canWrite: boolean;
  groupActive: boolean;
  onChanged: () => void;
}) {
  const statusInfo = SYNC_STATUS_LABEL[asset.byteplusSyncStatus] ?? { label: asset.byteplusSyncStatus, variant: "outline" as const };
  const [retrying, setRetrying] = useState(false);

  const onSync = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/workspace/series/${seriesId}/assets/${asset.id}/sync-byteplus`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "同步失败");
      toast.success("已触发同步");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败");
    } finally {
      setRetrying(false);
    }
  }, [seriesId, asset.id, onChanged]);

  return (
    <div className="rounded-lg border p-3">
      <div className="aspect-video w-full overflow-hidden rounded bg-muted">
        {asset.type === "IMAGE" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.ossPublicUrl} alt={asset.name} className="h-full w-full object-cover" />
        )}
        {asset.type === "VIDEO" && (
          <video src={asset.ossPublicUrl} controls preload="metadata" className="h-full w-full" />
        )}
        {asset.type === "AUDIO" && (
          <div className="flex h-full items-center justify-center p-3">
            <audio src={asset.ossPublicUrl} controls className="w-full" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={asset.name}>{asset.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {SOURCE_LABEL[asset.source] ?? asset.source} · {(asset.bytes / 1024 / 1024).toFixed(2)}MB
            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
            {asset.durationSec ? ` · ${asset.durationSec.toFixed(1)}s` : ""}
          </p>
        </div>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </div>
      {asset.byteplusSyncError && (
        <p className="mt-2 truncate text-xs text-destructive" title={asset.byteplusSyncError}>
          {asset.byteplusSyncError}
        </p>
      )}
      {canWrite && groupActive && (asset.byteplusSyncStatus === "NOT_SYNCED" || asset.byteplusSyncStatus === "FAILED") && (
        <Button size="sm" variant="outline" className="mt-2 w-full" disabled={retrying} onClick={onSync}>
          {retrying ? "处理中…" : asset.byteplusSyncStatus === "FAILED" ? "重试同步" : "同步到资产库"}
        </Button>
      )}
    </div>
  );
}
