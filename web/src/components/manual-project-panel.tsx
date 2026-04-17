"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface ProjectShape {
  id: string;
  name: string;
  script: string;
  fullScript: string;
  style: string;
  ratio: string;
  resolution: string;
  assetsJson: unknown;
  assetDescriptions: unknown;
}

interface AssetRow {
  index_label: string;
  asset_name: string;
  asset_uri: string;
}

interface Props {
  project: ProjectShape;
  onUpdate: () => void;
  creationMode?: "AUTO" | "MANUAL";
}

export function ManualProjectPanel({ project, onUpdate, creationMode = "MANUAL" }: Props) {
  const isManual = creationMode === "MANUAL";
  const [name, setName] = useState(project.name);
  const [style, setStyle] = useState(project.style);
  const [ratio, setRatio] = useState(project.ratio);
  const [resolution, setResolution] = useState(project.resolution);
  const [script, setScript] = useState(project.script);
  const [fullScript, setFullScript] = useState(project.fullScript);
  const [assetsJsonText, setAssetsJsonText] = useState(() =>
    JSON.stringify(project.assetsJson ?? {}, null, 2)
  );
  const [descText, setDescText] = useState(() =>
    JSON.stringify(project.assetDescriptions ?? {}, null, 2)
  );
  const [savingProject, setSavingProject] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newDuration, setNewDuration] = useState("10");
  const [newAssets, setNewAssets] = useState<AssetRow[]>([]);
  const [savingSb, setSavingSb] = useState(false);

  useEffect(() => {
    setName(project.name);
    setStyle(project.style);
    setRatio(project.ratio);
    setResolution(project.resolution);
    setScript(project.script);
    setFullScript(project.fullScript);
    setAssetsJsonText(JSON.stringify(project.assetsJson ?? {}, null, 2));
    setDescText(JSON.stringify(project.assetDescriptions ?? {}, null, 2));
  }, [project]);

  async function saveProject() {
    let assetsJson: unknown = {};
    let assetDescriptions: unknown = {};
    try {
      if (assetsJsonText.trim()) assetsJson = JSON.parse(assetsJsonText);
    } catch {
      toast.error("资产列表 JSON 格式错误");
      return;
    }
    try {
      if (descText.trim()) assetDescriptions = JSON.parse(descText);
    } catch {
      toast.error("资产描述 JSON 格式错误");
      return;
    }

    setSavingProject(true);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        style,
        ratio,
        resolution,
        script,
        fullScript,
        assetsJson,
        assetDescriptions,
      }),
    });
    setSavingProject(false);
    if (!res.ok) {
      const d = await res.json();
      toast.error(d.error || "保存失败");
      return;
    }
    toast.success("项目信息已保存");
    onUpdate();
  }

  function openAddStoryboard() {
    setNewPrompt("");
    setNewDuration("10");
    setNewAssets([]);
    setAddOpen(true);
  }

  function updateNewAsset(i: number, field: keyof AssetRow, v: string) {
    setNewAssets((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: v };
      return next;
    });
  }

  async function saveNewStoryboard() {
    if (!newPrompt.trim()) {
      toast.error("请填写提示词");
      return;
    }
    setSavingSb(true);
    const res = await fetch(`/api/projects/${project.id}/storyboards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: newPrompt,
        duration: parseInt(newDuration, 10),
        assetBindings: newAssets,
      }),
    });
    setSavingSb(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "添加失败");
      return;
    }
    toast.success(`已添加分镜 ${data.storyboardId}`);
    setAddOpen(false);
    onUpdate();
  }

  return (
    <>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">
            {isManual ? "手动项目设置" : "项目信息编辑"}
          </CardTitle>
          <CardDescription>
            {isManual
              ? "在此保存项目名称、画幅、剧本与资产 JSON；分镜 ID 在添加时自动编号（s001、s002…）"
              : "编辑剧本、资产等项目信息后保存；可点击「重新生成分镜」基于新内容生成"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>项目名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>美术风格</Label>
              <Input value={style} onChange={(e) => setStyle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>画幅</Label>
                <Select value={ratio} onValueChange={(v) => v && setRatio(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="9:16">9:16</SelectItem>
                    <SelectItem value="16:9">16:9</SelectItem>
                    <SelectItem value="4:3">4:3</SelectItem>
                    <SelectItem value="3:4">3:4</SelectItem>
                    <SelectItem value="1:1">1:1</SelectItem>
                    <SelectItem value="21:9">21:9</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>分辨率</Label>
                <Select value={resolution} onValueChange={(v) => v && setResolution(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="480p">480p</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>剧本（可选）</Label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={4}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>完整剧本 / 备注（可选）</Label>
            <Textarea
              value={fullScript}
              onChange={(e) => setFullScript(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>资产列表 JSON</Label>
            <Textarea
              value={assetsJsonText}
              onChange={(e) => setAssetsJsonText(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>资产描述 JSON</Label>
            <Textarea
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveProject} disabled={savingProject}>
              {savingProject ? "保存中…" : "保存项目信息"}
            </Button>
            {isManual && (
              <Button variant="secondary" onClick={openAddStoryboard}>
                添加分镜（自动编号）
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建分镜</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              保存后将自动分配编号（如已有 s001、s002，则下一条为 s003）
            </p>
            <div className="space-y-2">
              <Label>时长（秒）</Label>
              <Select value={newDuration} onValueChange={(v) => v && setNewDuration(v)}>
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
            <div className="space-y-2">
              <Label>提示词</Label>
              <Textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">参考资产（可选）</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setNewAssets((p) => [
                    ...p,
                    {
                      index_label: `图${p.length + 1}`,
                      asset_name: "",
                      asset_uri: "",
                    },
                  ])
                }
              >
                + 添加一行
              </Button>
            </div>
            {newAssets.map((ab, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[56px_1fr_1fr_28px] gap-2 items-center"
              >
                <Input
                  className="text-xs"
                  value={ab.index_label}
                  onChange={(e) =>
                    updateNewAsset(idx, "index_label", e.target.value)
                  }
                />
                <Input
                  className="text-xs"
                  placeholder="名称"
                  value={ab.asset_name}
                  onChange={(e) =>
                    updateNewAsset(idx, "asset_name", e.target.value)
                  }
                />
                <Input
                  className="text-xs font-mono"
                  placeholder="asset://…"
                  value={ab.asset_uri}
                  onChange={(e) =>
                    updateNewAsset(idx, "asset_uri", e.target.value)
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-0 text-destructive"
                  onClick={() =>
                    setNewAssets((p) => p.filter((_, i) => i !== idx))
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                取消
              </Button>
              <Button onClick={saveNewStoryboard} disabled={savingSb}>
                {savingSb ? "保存中…" : "保存到库"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
