"use client";

/**
 * v2.0.0：分镜资产选择器。
 *
 * 工作模式：
 *  - FIRST_FRAME：first_frame 必选，last_frame 可选，禁用 reference_*
 *  - MULTIMODAL：reference_image 1-9 张，reference_video ≤ 3 个（总时长 ≤ 15s 由后端校验），
 *               reference_audio ≤ 1 个，不能只有音频
 *
 * 父组件负责传入当前 seriesId + 已选 refs，picker 内部弹出二级 Modal 浏览/筛选 SYNCED 资产。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type GenerationMode = "FIRST_FRAME" | "MULTIMODAL";

export interface AssetRefs {
  first_frame_asset_id?: string | null;
  last_frame_asset_id?: string | null;
  reference_image_asset_ids?: string[];
  reference_video_asset_ids?: string[];
  reference_audio_asset_id?: string | null;
}

interface SeriesAssetMini {
  id: string;
  name: string;
  type: "IMAGE" | "VIDEO" | "AUDIO";
  ossPublicUrl: string;
  byteplusSyncStatus: string;
  durationSec: number | null;
  bytes: number;
}

const fetcher = async (url: string): Promise<{ items: SeriesAssetMini[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("加载素材失败");
  return res.json();
};

export function AssetPickerModal({
  open,
  onOpenChange,
  seriesId,
  initialMode,
  initialRefs,
  initialDisplayName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seriesId: string;
  initialMode: GenerationMode;
  initialRefs: AssetRefs;
  /** v1.10.0：分镜自定义显示名初始值（picker 内可编辑，confirm 时回传） */
  initialDisplayName?: string;
  onConfirm: (mode: GenerationMode, refs: AssetRefs, displayName: string) => void;
}) {
  const [mode, setMode] = useState<GenerationMode>(initialMode);
  const [refs, setRefs] = useState<AssetRefs>(initialRefs);
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [pickerFor, setPickerFor] = useState<null | { slot: string; type: SeriesAssetMini["type"]; multi: boolean }>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setRefs(initialRefs);
      setDisplayName(initialDisplayName ?? "");
    }
  }, [open, initialMode, initialRefs, initialDisplayName]);

  function changeMode(next: GenerationMode) {
    setMode(next);
    // 切换模式时清空对方字段，避免提交时冲突
    if (next === "FIRST_FRAME") {
      setRefs({
        first_frame_asset_id: refs.first_frame_asset_id ?? null,
        last_frame_asset_id: refs.last_frame_asset_id ?? null,
      });
    } else {
      setRefs({
        reference_image_asset_ids: refs.reference_image_asset_ids ?? [],
        reference_video_asset_ids: refs.reference_video_asset_ids ?? [],
        reference_audio_asset_id: refs.reference_audio_asset_id ?? null,
      });
    }
  }

  function onPicked(asset: SeriesAssetMini) {
    if (!pickerFor) return;
    // v1.10.0：FIRST_FRAME 模式选首帧时 / MULTIMODAL 模式选第一张参考图时，
    // 若 displayName 为空则用该资产名自动填充（用户可手动改）
    const slot = pickerFor.slot;
    const isFirstFrame = slot === "first_frame";
    const isFirstRefImage =
      slot === "reference_image" && (refs.reference_image_asset_ids?.length ?? 0) === 0;
    if ((isFirstFrame || isFirstRefImage) && displayName.trim() === "") {
      setDisplayName(asset.name);
    }
    setRefs((prev) => {
      const next = { ...prev };
      switch (slot) {
        case "first_frame":
          next.first_frame_asset_id = asset.id;
          break;
        case "last_frame":
          next.last_frame_asset_id = asset.id;
          break;
        case "reference_image":
          next.reference_image_asset_ids = [...(prev.reference_image_asset_ids ?? []), asset.id];
          break;
        case "reference_video":
          next.reference_video_asset_ids = [...(prev.reference_video_asset_ids ?? []), asset.id];
          break;
        case "reference_audio":
          next.reference_audio_asset_id = asset.id;
          break;
      }
      return next;
    });
    setPickerFor(null);
  }

  function clearSlot(slot: string, idx?: number) {
    setRefs((prev) => {
      const next = { ...prev };
      switch (slot) {
        case "first_frame":
          next.first_frame_asset_id = null;
          break;
        case "last_frame":
          next.last_frame_asset_id = null;
          break;
        case "reference_image":
          if (idx != null) {
            next.reference_image_asset_ids = (prev.reference_image_asset_ids ?? []).filter((_, i) => i !== idx);
          }
          break;
        case "reference_video":
          if (idx != null) {
            next.reference_video_asset_ids = (prev.reference_video_asset_ids ?? []).filter((_, i) => i !== idx);
          }
          break;
        case "reference_audio":
          next.reference_audio_asset_id = null;
          break;
      }
      return next;
    });
  }

  function validate(): string | null {
    if (mode === "FIRST_FRAME") {
      if (!refs.first_frame_asset_id) return "首帧必填";
    } else {
      const imgCount = refs.reference_image_asset_ids?.length ?? 0;
      const vidCount = refs.reference_video_asset_ids?.length ?? 0;
      const hasAudio = !!refs.reference_audio_asset_id;
      if (imgCount === 0 && vidCount === 0 && !hasAudio) return "至少选择一个图片 / 视频 / 音频参考";
      if (imgCount === 0 && vidCount === 0 && hasAudio) return "不能只选音频";
      if (imgCount > 9) return "参考图最多 9 张";
      if (vidCount > 3) return "参考视频最多 3 个";
    }
    return null;
  }

  const allRefIds = useMemo(() => {
    const ids: string[] = [];
    if (refs.first_frame_asset_id) ids.push(refs.first_frame_asset_id);
    if (refs.last_frame_asset_id) ids.push(refs.last_frame_asset_id);
    for (const id of refs.reference_image_asset_ids ?? []) ids.push(id);
    for (const id of refs.reference_video_asset_ids ?? []) ids.push(id);
    if (refs.reference_audio_asset_id) ids.push(refs.reference_audio_asset_id);
    return ids;
  }, [refs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>分镜资产绑定</DialogTitle>
          <DialogDescription>
            首帧/尾帧模式与多模态参考模式互斥；所有资产必须来自当前 Series 绑定的 Asset Group 且已同步。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">分镜显示名（可选，最多 80 字符）</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder="留空则用 storyboardId；选首帧资产时会自动填入资产名"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">生成模式</Label>
            <div className="mt-2 flex gap-2">
              <Button
                variant={mode === "FIRST_FRAME" ? "default" : "outline"}
                size="sm"
                onClick={() => changeMode("FIRST_FRAME")}
              >
                首帧 / 尾帧
              </Button>
              <Button
                variant={mode === "MULTIMODAL" ? "default" : "outline"}
                size="sm"
                onClick={() => changeMode("MULTIMODAL")}
              >
                多模态参考
              </Button>
            </div>
          </div>

          {mode === "FIRST_FRAME" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <AssetSlot
                label="首帧（必填）"
                seriesId={seriesId}
                assetId={refs.first_frame_asset_id}
                onSelect={() => setPickerFor({ slot: "first_frame", type: "IMAGE", multi: false })}
                onClear={() => clearSlot("first_frame")}
              />
              <AssetSlot
                label="尾帧（可选）"
                seriesId={seriesId}
                assetId={refs.last_frame_asset_id}
                onSelect={() => setPickerFor({ slot: "last_frame", type: "IMAGE", multi: false })}
                onClear={() => clearSlot("last_frame")}
              />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">参考图（1-9 张）</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(refs.reference_image_asset_ids ?? []).map((id, idx) => (
                    <AssetSlot
                      key={idx}
                      label={`图 ${idx + 1}`}
                      seriesId={seriesId}
                      assetId={id}
                      onClear={() => clearSlot("reference_image", idx)}
                    />
                  ))}
                  {(refs.reference_image_asset_ids?.length ?? 0) < 9 && (
                    <Button
                      variant="outline"
                      onClick={() => setPickerFor({ slot: "reference_image", type: "IMAGE", multi: true })}
                      className="h-24"
                    >
                      + 添加图片
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs">参考视频（最多 3 个，总时长 ≤ 15 秒）</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(refs.reference_video_asset_ids ?? []).map((id, idx) => (
                    <AssetSlot
                      key={idx}
                      label={`视频 ${idx + 1}`}
                      seriesId={seriesId}
                      assetId={id}
                      onClear={() => clearSlot("reference_video", idx)}
                    />
                  ))}
                  {(refs.reference_video_asset_ids?.length ?? 0) < 3 && (
                    <Button
                      variant="outline"
                      onClick={() => setPickerFor({ slot: "reference_video", type: "VIDEO", multi: true })}
                      className="h-20"
                    >
                      + 添加视频
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs">参考音频（可选，仅 1 个；不能只有音频）</Label>
                <div className="mt-2">
                  {refs.reference_audio_asset_id ? (
                    <AssetSlot
                      label="音频"
                      seriesId={seriesId}
                      assetId={refs.reference_audio_asset_id}
                      onClear={() => clearSlot("reference_audio")}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerFor({ slot: "reference_audio", type: "AUDIO", multi: false })}
                    >
                      + 添加音频
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">已选 {allRefIds.length} 个资产</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={() => {
              const err = validate();
              if (err) {
                alert(err);
                return;
              }
              const trimmed = displayName.trim();
              if (trimmed.length > 80) {
                alert("分镜名称最长 80 字符");
                return;
              }
              onConfirm(mode, refs, trimmed);
              onOpenChange(false);
            }}
          >
            确认
          </Button>
        </DialogFooter>

        {pickerFor && (
          <AssetSelector
            seriesId={seriesId}
            type={pickerFor.type}
            excludeIds={allRefIds}
            onClose={() => setPickerFor(null)}
            onPick={onPicked}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssetSlot({
  label,
  seriesId,
  assetId,
  onSelect,
  onClear,
}: {
  label: string;
  seriesId: string;
  assetId?: string | null;
  onSelect?: () => void;
  onClear?: () => void;
}) {
  const { data } = useSWR<SeriesAssetMini | null>(
    assetId ? `/api/workspace/series/${seriesId}/assets/${assetId}` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.json();
    },
  );

  return (
    <div className="rounded border p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="text-muted-foreground">{label}</span>
        {assetId && onClear && (
          <button onClick={onClear} className="text-destructive">×</button>
        )}
      </div>
      {assetId ? (
        <div className="space-y-1">
          {data?.type === "IMAGE" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.ossPublicUrl} alt={data.name} className="h-20 w-full rounded object-cover" />
          )}
          {data?.type === "VIDEO" && (
            <video src={data.ossPublicUrl} className="h-20 w-full rounded" preload="metadata" muted />
          )}
          {data?.type === "AUDIO" && (
            <div className="flex h-20 items-center justify-center rounded bg-muted">🎵</div>
          )}
          <p className="truncate" title={data?.name}>{data?.name ?? "—"}</p>
        </div>
      ) : onSelect ? (
        <Button variant="outline" size="sm" className="h-16 w-full" onClick={onSelect}>选择</Button>
      ) : null}
    </div>
  );
}

function AssetSelector({
  seriesId,
  type,
  excludeIds,
  onClose,
  onPick,
}: {
  seriesId: string;
  type: SeriesAssetMini["type"];
  excludeIds: string[];
  onClose: () => void;
  onPick: (a: SeriesAssetMini) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const { data, isLoading } = useSWR(
    `/api/workspace/series/${seriesId}/assets?type=${type}&syncStatus=SYNCED&size=100${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`,
    fetcher,
  );

  const filtered = useMemo(
    () => (data?.items ?? []).filter((a) => !excludeIds.includes(a.id)),
    [data, excludeIds],
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择资产</DialogTitle>
          <DialogDescription>仅显示当前 Series 已同步到 BytePlus 的 {type} 资产</DialogDescription>
        </DialogHeader>
        <Input placeholder="按名称搜索" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <div className="mt-2 max-h-[400px] overflow-auto">
          {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">无可用资产</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => onPick(a)}
                className="rounded border p-2 text-left hover:bg-accent"
              >
                {a.type === "IMAGE" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.ossPublicUrl} alt={a.name} className="h-20 w-full rounded object-cover" />
                )}
                {a.type === "VIDEO" && (
                  <video src={a.ossPublicUrl} className="h-20 w-full rounded" preload="metadata" muted />
                )}
                {a.type === "AUDIO" && (
                  <div className="flex h-20 items-center justify-center rounded bg-muted">🎵</div>
                )}
                <p className="mt-1 truncate text-xs" title={a.name}>{a.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {(a.bytes / 1024 / 1024).toFixed(1)}MB
                  {a.durationSec ? ` · ${a.durationSec.toFixed(1)}s` : ""}
                </p>
                <Badge variant="secondary" className="mt-1">已同步</Badge>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
