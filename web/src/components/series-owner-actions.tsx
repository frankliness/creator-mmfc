"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export type SeriesOwnerActionsProps = {
  seriesId: string;
  projectId: string;
  locked: boolean;
  lockedReason: string | null;
};

export function SeriesOwnerActions({
  seriesId,
  projectId,
  locked,
  lockedReason,
}: SeriesOwnerActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function stopAll(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
  }

  async function callLock() {
    if (!reason.trim()) {
      toast.error("请填写锁定原因");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspace/series/${seriesId}/projects/${projectId}/lock`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "锁定失败");
      }
      toast.success("已锁定");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "锁定失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function callUnlock(e: React.MouseEvent) {
    stopAll(e);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspace/series/${seriesId}/projects/${projectId}/unlock`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "解锁失败");
      }
      toast.success("已解锁");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return (
      <Button
        size="sm"
        variant="outline"
        title={lockedReason || "已锁定"}
        disabled={submitting}
        onClick={callUnlock}
      >
        🔓 解锁
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={submitting}
        onClick={(e) => {
          stopAll(e);
          setOpen(true);
        }}
      >
        🔒 锁定
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={stopAll}>
          <DialogHeader>
            <DialogTitle>锁定集数</DialogTitle>
            <DialogDescription>
              锁定后该集数的所有写操作（提交分镜、生成视频等）将被拒绝。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>锁定原因（必填）</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="例如：等待客户确认脚本"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={callLock} disabled={submitting}>
              {submitting ? "提交中…" : "确认锁定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
