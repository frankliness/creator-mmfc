"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SAMPLE_ASSETS = JSON.stringify(
  {
    人物: [{ name: "伊莎贝拉", asset_id: "asset-xxxx" }],
    场景: [{ name: "小院", asset_id: "asset-yyyy" }],
  },
  null,
  2
);

const SAMPLE_DESCRIPTIONS = JSON.stringify(
  {
    伊莎贝拉: "一个红发女子的全身肖像，表情温柔且关怀...",
    小院: "一个古典的、砖砌小院，夜晚...",
  },
  null,
  2
);

type Mode = "AUTO" | "MANUAL";

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("AUTO");
  const [loading, setLoading] = useState(false);

  async function handleAutoSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    let assetsJson = {};
    let assetDescriptions = {};

    try {
      const rawAssets = formData.get("assetsJson") as string;
      if (rawAssets.trim()) assetsJson = JSON.parse(rawAssets);
    } catch {
      toast.error("资产列表 JSON 格式错误");
      setLoading(false);
      return;
    }

    try {
      const rawDesc = formData.get("assetDescriptions") as string;
      if (rawDesc.trim()) assetDescriptions = JSON.parse(rawDesc);
    } catch {
      toast.error("资产描述 JSON 格式错误");
      setLoading(false);
      return;
    }

    const body = {
      creationMode: "AUTO" as const,
      name: formData.get("name"),
      script: formData.get("script"),
      fullScript: formData.get("fullScript") || "",
      assetsJson,
      assetDescriptions,
      style: formData.get("style"),
      ratio: formData.get("ratio"),
      resolution: formData.get("resolution"),
    };

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setLoading(false);
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "创建失败");
      return;
    }

    toast.success("项目创建成功");
    router.push(`/projects/${data.id}`);
  }

  async function handleManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      creationMode: "MANUAL" as const,
      name: (formData.get("manualName") as string)?.trim(),
      script: (formData.get("manualScript") as string) || "",
      fullScript: (formData.get("manualFullScript") as string) || "",
      style: (formData.get("manualStyle") as string) || "未指定",
      ratio: formData.get("manualRatio") as string,
      resolution: formData.get("manualResolution") as string,
      assetsJson: {},
      assetDescriptions: {},
    };

    if (!body.name) {
      toast.error("请填写项目名称");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setLoading(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "创建失败");
      return;
    }

    toast.success("手动项目已创建，请添加分镜");
    router.push(`/projects/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex rounded-lg border p-1 bg-muted/40">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "AUTO"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMode("AUTO")}
        >
          自动（AI 生成分镜）
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "MANUAL"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMode("MANUAL")}
        >
          手动（自建分镜）
        </button>
      </div>

      {mode === "AUTO" && (
        <Card>
          <CardHeader>
            <CardTitle>新建创作项目 · 自动</CardTitle>
            <CardDescription>
              填写剧本与资产后，由 Gemini 生成分镜；进入项目页后可审核与提交 Seedance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAutoSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">项目名称</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="例如：第2集 - 小院打斗"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="script">当前集剧本</Label>
                <Textarea
                  id="script"
                  name="script"
                  placeholder="粘贴当前集的完整剧本..."
                  rows={10}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullScript">完整剧本（可选）</Label>
                <Textarea
                  id="fullScript"
                  name="fullScript"
                  placeholder="全剧剧本，帮助模型理解世界观..."
                  rows={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assetsJson">资产列表（JSON）</Label>
                <Textarea
                  id="assetsJson"
                  name="assetsJson"
                  placeholder={SAMPLE_ASSETS}
                  rows={8}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assetDescriptions">资产描述（JSON）</Label>
                <Textarea
                  id="assetDescriptions"
                  name="assetDescriptions"
                  placeholder={SAMPLE_DESCRIPTIONS}
                  rows={6}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="style">美术/视觉风格</Label>
                <Input
                  id="style"
                  name="style"
                  placeholder="例如：电影级实拍风格"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>画幅比例</Label>
                  <Select name="ratio" defaultValue="9:16">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 竖屏</SelectItem>
                      <SelectItem value="16:9">16:9 横屏</SelectItem>
                      <SelectItem value="4:3">4:3</SelectItem>
                      <SelectItem value="3:4">3:4</SelectItem>
                      <SelectItem value="1:1">1:1 方形</SelectItem>
                      <SelectItem value="21:9">21:9 超宽</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>分辨率</Label>
                  <Select name="resolution" defaultValue="720p">
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

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "创建中..." : "创建项目"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {mode === "MANUAL" && (
        <Card>
          <CardHeader>
            <CardTitle>新建创作项目 · 手动</CardTitle>
            <CardDescription>
              仅创建空项目并进入详情页；在项目内保存参数、逐条添加分镜（编号自动为
              s001、s002…）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="manualName">项目名称</Label>
                <Input
                  id="manualName"
                  name="manualName"
                  placeholder="例如：广告短片 · 手动分镜"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manualStyle">美术风格（可选）</Label>
                <Input
                  id="manualStyle"
                  name="manualStyle"
                  placeholder="可稍后在项目页修改"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>画幅</Label>
                  <Select name="manualRatio" defaultValue="9:16">
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
                  <Select name="manualResolution" defaultValue="720p">
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
              <div className="space-y-2">
                <Label htmlFor="manualScript">剧本备注（可选）</Label>
                <Textarea
                  id="manualScript"
                  name="manualScript"
                  rows={4}
                  placeholder="可先留空，在项目页补充"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manualFullScript">完整剧本（可选）</Label>
                <Textarea
                  id="manualFullScript"
                  name="manualFullScript"
                  rows={3}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "创建中…" : "创建并进入项目"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
