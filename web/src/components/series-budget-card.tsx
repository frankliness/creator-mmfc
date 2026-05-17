"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export type SeriesBudgetCardProps = {
  seriesId: string;
  budget: {
    id: string;
    provider: string;
    modelKey: string;
    budgetScope: string;
    metricType: string;
    totalBudget: string | number | bigint;
    committedUsage: string | number | bigint;
    reservedUsage: string | number | bigint;
    unallocatedBudget: string | number | bigint;
    status: string;
  };
  episodes: Array<{
    id: string;
    episodeNumber: number | null;
    episodeTitle: string | null;
    name: string;
  }>;
  canAllocate: boolean;
};

export function SeriesBudgetCard({
  seriesId,
  budget,
  episodes,
  canAllocate,
}: SeriesBudgetCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const total = Number(budget.totalBudget);
  const committed = Number(budget.committedUsage);
  const reserved = Number(budget.reservedUsage);
  const unallocated = Number(budget.unallocatedBudget);
  const used = committed + reserved;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  const isCanvasGlobal =
    budget.provider === "canvas" && budget.modelKey === "*";
  const isToken = budget.metricType === "TOKEN";
  const showAllocate = canAllocate && isToken && !isCanvasGlobal;

  const title = isCanvasGlobal
    ? "画布生图（全局）"
    : `${budget.budgetScope} · ${budget.modelKey}`;

  async function onSubmit() {
    if (!projectId) {
      toast.error("请选择集数");
      return;
    }
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("delta 必须是非零数字");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspace/series/${seriesId}/resource-budgets/${budget.id}/allocate-buffer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            delta: String(Math.trunc(n)),
            reason: reason.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "调配失败");
      }
      toast.success("Buffer 调配成功");
      setOpen(false);
      setDelta("");
      setReason("");
      setProjectId("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "调配失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {budget.provider} · {budget.metricType}
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-2 h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          已用 {committed.toLocaleString()} · 预扣 {reserved.toLocaleString()} ·
          总 {total.toLocaleString()} · buffer{" "}
          {unallocated.toLocaleString()}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <Badge
            variant={budget.status === "ACTIVE" ? "outline" : "destructive"}
          >
            {budget.status}
          </Badge>
          {showAllocate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
            >
              调配 Buffer
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调配 Buffer</DialogTitle>
            <DialogDescription>
              正数：从 buffer 拨给该集数；负数：从该集数收回到 buffer。
              当前 buffer 余量：{unallocated.toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>目标集数</Label>
              <Select
                value={projectId}
                onValueChange={(v) => setProjectId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择集数" />
                </SelectTrigger>
                <SelectContent>
                  {episodes.map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      第 {ep.episodeNumber ?? "-"} 集 ·{" "}
                      {ep.episodeTitle || ep.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>delta（正数=拨入，负数=收回）</Label>
              <Input
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="例如 50000 或 -10000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>原因（可选）</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="便于在 BudgetEvent 日志中追溯"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? "提交中…" : "提交"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
