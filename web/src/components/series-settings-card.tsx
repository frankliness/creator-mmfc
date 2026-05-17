"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface Props {
  seriesId: string;
  canEdit: boolean;
  defaults: {
    defaultStyle: string;
    defaultRatio: string;
    defaultResolution: string;
    defaultSeed: number;
  };
}

const RATIO_OPTIONS = ["9:16", "16:9", "1:1", "3:4", "4:3", "21:9"];
const RES_OPTIONS = ["480p", "720p", "1080p"];

export function SeriesSettingsCard({ seriesId, canEdit, defaults }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState(defaults.defaultStyle);
  const [ratio, setRatio] = useState(defaults.defaultRatio || "9:16");
  const [resolution, setResolution] = useState(defaults.defaultResolution || "720p");
  const [seed, setSeed] = useState<number>(defaults.defaultSeed ?? 0);

  const missing: string[] = [];
  if (!defaults.defaultStyle?.trim()) missing.push("风格");
  if (!defaults.defaultRatio?.trim()) missing.push("画幅");
  if (!defaults.defaultResolution?.trim()) missing.push("分辨率");

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/series/${seriesId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultStyle: style,
          defaultRatio: ratio,
          defaultResolution: resolution,
          defaultSeed: Number(seed) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "保存失败");
        return;
      }
      toast.success("已保存并同步到所有集数");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">项目默认设置（全局）</CardTitle>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              编辑
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {missing.length > 0 && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠️ 尚未配置：{missing.join("、")}。集数提交视频生成会被拒绝。
            {canEdit ? "请点击右上角『编辑』完成配置。" : "请联系导演完成配置。"}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">风格</div>
            <div className="mt-1 break-words">{defaults.defaultStyle || <span className="text-muted-foreground">未设置</span>}</div>
          </div>
          <div>
            <div className="text-muted-foreground">画幅</div>
            <div className="mt-1">{defaults.defaultRatio || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">分辨率</div>
            <div className="mt-1">{defaults.defaultResolution || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">默认 Seed</div>
            <div className="mt-1">
              {defaults.defaultSeed === 0 ? <span className="text-muted-foreground">随机</span> : defaults.defaultSeed}
            </div>
          </div>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑 Series 默认设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>风格</Label>
              <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="例如：写实电影感、卡通日漫风" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>画幅</Label>
                <Select value={ratio} onValueChange={(v) => v && setRatio(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATIO_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>分辨率</Label>
                <Select value={resolution} onValueChange={(v) => v && setResolution(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RES_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>默认 Seed（0 = 每集随机；推荐保留 0）</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={2147483647}
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeed(Math.floor(Math.random() * 2147483647) + 1)}
                >
                  随机
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSeed(0)}
                >
                  设为 0
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              保存后会同步覆盖该 Series 下所有集数的对应设置。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存并同步"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
