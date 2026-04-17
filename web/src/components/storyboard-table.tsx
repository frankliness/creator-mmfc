"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface AssetBinding {
  index_label: string;
  asset_name: string;
  asset_uri: string;
}

interface SeedanceContentItem {
  type: string;
  image_url: { url: string };
  role: string;
}

interface Task {
  id: string;
  arkTaskId: string;
  model: string;
  status: string;
  arkStatus: string | null;
  videoUrl: string | null;
  localVideoPath: string | null;
  gcsVideoPath: string | null;
  seed: string | null;
  resolution: string | null;
  ratio: string | null;
  duration: number | null;
  completionTokens: string | null;
  totalTokens: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Storyboard {
  id: string;
  storyboardId: string;
  sortOrder: number;
  duration: number;
  prompt: string;
  assetBindings: AssetBinding[];
  seedanceContentItems: SeedanceContentItem[];
  status: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  projectId: string;
  storyboards: Storyboard[];
  projectStatus: string;
  onUpdate: () => void;
}

const storyboardStatusLabels: Record<string, string> = {
  DRAFT: "待提交",
  APPROVED: "已审核",
  SUBMITTED: "已提交",
  GENERATING: "生成中",
  SUCCEEDED: "成功",
  FAILED: "失败",
};

const storyboardStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  SUBMITTED: "secondary",
  GENERATING: "default",
  SUCCEEDED: "default",
  FAILED: "destructive",
};

const taskStatusLabels: Record<string, string> = {
  SUBMITTED: "已提交",
  RUNNING: "运行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  PERSISTING: "下载中",
  PERSISTED: "已保存",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function StoryboardTable({ projectId, storyboards, onUpdate }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editDuration, setEditDuration] = useState("10");
  const [editAssetBindings, setEditAssetBindings] = useState<AssetBinding[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === storyboards.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(storyboards.map((s) => s.id)));
    }
  }

  function openEdit(sb: Storyboard) {
    setEditingId(sb.id);
    setEditPrompt(sb.prompt);
    setEditDuration(String(sb.duration));
    setEditAssetBindings(
      Array.isArray(sb.assetBindings)
        ? sb.assetBindings.map((a) => ({ ...a }))
        : []
    );
  }

  function updateAssetBinding(idx: number, field: keyof AssetBinding, value: string) {
    setEditAssetBindings((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function removeAssetBinding(idx: number) {
    setEditAssetBindings((prev) => prev.filter((_, i) => i !== idx));
  }

  function addAssetBinding() {
    setEditAssetBindings((prev) => [
      ...prev,
      { index_label: `图${prev.length + 1}`, asset_name: "", asset_uri: "" },
    ]);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);

    const normalizedBindings = editAssetBindings.map((a) => ({
      ...a,
      asset_uri: a.asset_uri.startsWith("asset://")
        ? a.asset_uri
        : `asset://${a.asset_uri}`,
    }));

    const normalizedItems = normalizedBindings.map((a) => ({
      type: "image_url" as const,
      image_url: { url: a.asset_uri },
      role: "reference_image" as const,
    }));

    const res = await fetch(`/api/storyboards/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: editPrompt,
        duration: parseInt(editDuration),
        assetBindings: normalizedBindings,
        seedanceContentItems: normalizedItems,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已保存");
    setEditingId(null);
    onUpdate();
  }

  async function handleClone(sb: Storyboard) {
    setCloning(sb.id);
    const res = await fetch(`/api/storyboards/${sb.id}/clone`, {
      method: "POST",
    });
    setCloning(null);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "克隆失败");
      return;
    }
    toast.success(`已创建 ${data.storyboardId}，可编辑后提交`);
    onUpdate();
    // Auto-open edit for the new storyboard
    setTimeout(() => {
      openEdit({
        ...sb,
        id: data.id,
        storyboardId: data.storyboardId,
        status: "DRAFT",
      });
    }, 300);
  }

  async function submitSingle(storyboardId: string) {
    setSubmitting(storyboardId);
    const res = await fetch(`/api/storyboards/${storyboardId}/submit`, {
      method: "POST",
    });
    setSubmitting(null);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "提交失败");
      return;
    }
    toast.success("已提交生成");
    onUpdate();
  }

  async function submitBatch() {
    if (selected.size === 0) {
      toast.warning("请先选择分镜");
      return;
    }
    setBatchSubmitting(true);
    const res = await fetch(`/api/projects/${projectId}/submit-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyboardIds: Array.from(selected) }),
    });
    setBatchSubmitting(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "批量提交失败");
      return;
    }
    toast.success(`已提交 ${selected.size} 个分镜`);
    setSelected(new Set());
    onUpdate();
  }

  async function downloadBatch() {
    const downloadable = storyboards.filter((sb) => {
      const task = sb.tasks?.[0];
      return task && ["SUCCEEDED", "PERSISTED"].includes(task.status);
    });

    if (downloadable.length === 0) {
      toast.warning("没有已完成的视频可以下载");
      return;
    }

    const ids = selected.size > 0
      ? downloadable.filter((sb) => selected.has(sb.id)).map((sb) => sb.id)
      : downloadable.map((sb) => sb.id);

    if (ids.length === 0) {
      toast.warning("选中的分镜中没有已完成的视频");
      return;
    }

    setBatchDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/download-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboardIds: ids }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "下载失败");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      a.download = filenameMatch?.[1] || "videos.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`已下载 ${ids.length} 个视频`);
    } catch (err) {
      toast.error(`下载出错: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setBatchDownloading(false);
    }
  }

  const hasDownloadable = storyboards.some((sb) => {
    const task = sb.tasks?.[0];
    return task && ["SUCCEEDED", "PERSISTED"].includes(task.status);
  });

  const latestTask = (sb: Storyboard) => sb.tasks?.[0];
  const detailSb = storyboards.find((s) => s.id === detailId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          onClick={submitBatch}
          disabled={selected.size === 0 || batchSubmitting}
        >
          {batchSubmitting
            ? "提交中..."
            : `批量提交 (${selected.size})`}
        </Button>
        <Button
          variant="outline"
          onClick={downloadBatch}
          disabled={!hasDownloadable || batchDownloading}
        >
          {batchDownloading
            ? "打包中..."
            : selected.size > 0
              ? `批量下载 (${selected.size})`
              : "批量下载全部"}
        </Button>
        <span className="text-sm text-muted-foreground">
          共 {storyboards.length} 个分镜
        </span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selected.size === storyboards.length && storyboards.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-24">分镜</TableHead>
              <TableHead className="w-16">时长</TableHead>
              <TableHead>提示词</TableHead>
              <TableHead className="w-28">资产</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-48">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {storyboards.map((sb) => {
              const task = latestTask(sb);
              const isSucceeded = sb.status === "SUCCEEDED";
              const canSubmit = ["DRAFT", "FAILED", "APPROVED"].includes(sb.status);
              return (
                <TableRow key={sb.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(sb.id)}
                      onCheckedChange={() => toggleSelect(sb.id)}
                      disabled={!canSubmit}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {sb.storyboardId}
                  </TableCell>
                  <TableCell>{sb.duration}s</TableCell>
                  <TableCell>
                    <p className="line-clamp-3 max-w-md text-xs leading-relaxed">
                      {sb.prompt.slice(0, 200)}...
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(sb.assetBindings as AssetBinding[])?.slice(0, 3).map((a, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {a.index_label}
                        </Badge>
                      ))}
                      {(sb.assetBindings as AssetBinding[])?.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{(sb.assetBindings as AssetBinding[]).length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant={storyboardStatusVariant[sb.status] || "outline"}>
                        {storyboardStatusLabels[sb.status] || sb.status}
                      </Badge>
                      {task && ["SUCCEEDED", "PERSISTING", "PERSISTED"].includes(task.status) && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          onClick={() => setPreviewVideo(task.id)}
                        >
                          预览视频
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetailId(sb.id)}
                      >
                        详情
                      </Button>
                      {canSubmit && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(sb)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitSingle(sb.id)}
                            disabled={submitting === sb.id}
                          >
                            {submitting === sb.id ? "..." : "提交"}
                          </Button>
                        </>
                      )}
                      {isSucceeded && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClone(sb)}
                          disabled={cloning === sb.id}
                        >
                          {cloning === sb.id ? "..." : "重新编辑"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* 分镜详情弹窗 */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-6xl w-[92vw] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              分镜详情 — {detailSb?.storyboardId}
            </DialogTitle>
          </DialogHeader>
          {detailSb && (
            <div className="space-y-5">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">分镜编号：</span>
                  <span className="font-mono">{detailSb.storyboardId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">时长：</span>
                  {detailSb.duration}s
                </div>
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <Badge variant={storyboardStatusVariant[detailSb.status] || "outline"} className="ml-1">
                    {storyboardStatusLabels[detailSb.status] || detailSb.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">排序：</span>
                  {detailSb.sortOrder}
                </div>
                <div>
                  <span className="text-muted-foreground">创建时间：</span>
                  {formatTime(detailSb.createdAt)}
                </div>
                <div>
                  <span className="text-muted-foreground">更新时间：</span>
                  {formatTime(detailSb.updatedAt)}
                </div>
              </div>

              <Separator />

              {/* 资产绑定 */}
              <div>
                <h4 className="mb-2 text-sm font-medium">资产绑定 ({(detailSb.assetBindings as AssetBinding[])?.length || 0})</h4>
                <div className="space-y-1">
                  {(detailSb.assetBindings as AssetBinding[])?.map((a, i) => (
                    <div key={i} className="flex gap-3 text-xs font-mono bg-muted/50 rounded px-2 py-1">
                      <span className="text-muted-foreground w-10">{a.index_label}</span>
                      <span className="w-24">{a.asset_name}</span>
                      <span className="text-muted-foreground truncate">{a.asset_uri}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* 提示词 */}
              <div>
                <h4 className="mb-2 text-sm font-medium">提示词</h4>
                <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/50 rounded p-3 max-h-60 overflow-y-auto leading-relaxed">
                  {detailSb.prompt}
                </pre>
              </div>

              <Separator />

              {/* 任务记录 */}
              <div>
                <h4 className="mb-2 text-sm font-medium">
                  生成任务记录 ({detailSb.tasks?.length || 0})
                </h4>
                {(!detailSb.tasks || detailSb.tasks.length === 0) ? (
                  <p className="text-xs text-muted-foreground">暂无提交记录</p>
                ) : (
                  <div className="space-y-3">
                    {detailSb.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded border p-3 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium">{task.arkTaskId}</span>
                          <Badge variant={
                            task.status === "PERSISTED" || task.status === "SUCCEEDED"
                              ? "default"
                              : task.status === "FAILED"
                                ? "destructive"
                                : "secondary"
                          }>
                            {taskStatusLabels[task.status] || task.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                          <div>提交时间：{formatTime(task.createdAt)}</div>
                          <div>更新时间：{formatTime(task.updatedAt)}</div>
                          <div>Model：{task.model}</div>
                          <div>Seed：{task.seed || "—"}</div>
                          <div>分辨率：{task.resolution || "—"}</div>
                          <div>画幅：{task.ratio || "—"}</div>
                          <div>时长：{task.duration ? `${task.duration}s` : "—"}</div>
                          <div>Token：{task.totalTokens || "—"}</div>
                        </div>
                        {task.error && (
                          <div className="text-destructive bg-destructive/10 rounded px-2 py-1">
                            错误：{task.error}
                          </div>
                        )}
                        {task.status === "PERSISTED" && (
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              本地已保存
                            </Badge>
                            {task.gcsVideoPath && (
                              <Badge variant="outline" className="text-blue-600 border-blue-600">
                                GCS 已上传
                              </Badge>
                            )}
                          </div>
                        )}
                        {(task.status === "SUCCEEDED" || task.status === "PERSISTED" || task.status === "PERSISTING") && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDetailId(null);
                                setPreviewVideo(task.id);
                              }}
                            >
                              预览视频
                            </Button>
                            <a href={`/api/videos/${task.id}?download=1`} download>
                              <Button size="sm" variant="outline">
                                下载视频
                              </Button>
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 编辑弹窗 */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              编辑分镜 {storyboards.find((s) => s.id === editingId)?.storyboardId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">时长（秒）</label>
              <Select value={editDuration} onValueChange={(v) => v && setEditDuration(v)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 11, 12, 13, 14, 15].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">资产绑定</label>
                <Button size="sm" variant="outline" onClick={addAssetBinding}>
                  + 添加资产
                </Button>
              </div>
              {editAssetBindings.length === 0 && (
                <p className="text-xs text-muted-foreground">暂无资产绑定</p>
              )}
              {editAssetBindings.map((ab, idx) => (
                <div key={idx} className="grid grid-cols-[60px_1fr_1fr_32px] gap-2 items-center">
                  <Input
                    value={ab.index_label}
                    onChange={(e) => updateAssetBinding(idx, "index_label", e.target.value)}
                    placeholder="图1"
                    className="text-xs"
                  />
                  <Input
                    value={ab.asset_name}
                    onChange={(e) => updateAssetBinding(idx, "asset_name", e.target.value)}
                    placeholder="资产名称"
                    className="text-xs"
                  />
                  <Input
                    value={ab.asset_uri}
                    onChange={(e) => updateAssetBinding(idx, "asset_uri", e.target.value)}
                    placeholder="asset://asset-xxxx 或 asset-xxxx"
                    className="text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => removeAssetBinding(idx)}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              <label className="text-sm font-medium">提示词</label>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={18}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingId(null)}>
                取消
              </Button>
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 视频预览弹窗 */}
      <Dialog open={previewVideo !== null} onOpenChange={(open) => !open && setPreviewVideo(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>视频预览</DialogTitle>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-3">
              <video
                src={`/api/videos/${previewVideo}`}
                controls
                autoPlay
                className="w-full rounded-lg"
              />
              <div className="flex justify-end">
                <a
                  href={`/api/videos/${previewVideo}?download=1`}
                  download
                >
                  <Button variant="outline" size="sm">
                    下载视频
                  </Button>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
