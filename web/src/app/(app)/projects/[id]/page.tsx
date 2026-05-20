"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StoryboardTable } from "@/components/storyboard-table";
import { ManualProjectPanel } from "@/components/manual-project-panel";
import { SeedanceBudgetBar, type BudgetEntry } from "@/components/seedance-budget-bar";
import { SeriesCanvasLauncher } from "@/components/series-canvas-launcher";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const statusLabels: Record<string, string> = {
  DRAFT: "草稿",
  GENERATING_STORYBOARDS: "生成分镜中...",
  REVIEW: "待审核",
  GENERATING_VIDEOS: "生成视频中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const { data: budgets } = useSWR<BudgetEntry[]>(
    id ? `/api/projects/${id}/budget` : null,
    fetcher,
  );

  const { data: project, error, mutate } = useSWR(`/api/projects/${id}`, fetcher, {
    refreshInterval: (data) => {
      if (!data) return 0;
      if (["GENERATING_STORYBOARDS", "GENERATING_VIDEOS"].includes(data.status)) {
        return 3000;
      }
      if (data.storyboards?.some((s: { status: string }) => ["SUBMITTED", "GENERATING"].includes(s.status))) {
        return 5000;
      }
      return 0;
    },
  });

  if (error) return <div className="text-destructive">加载失败</div>;
  if (!project) return <div className="text-muted-foreground">加载中...</div>;

  const isViewer = project.myRole === "VIEWER";
  const isLocked = !!project.lockedReason;
  const isReadOnly = isViewer || isLocked;

  async function handleGenerateStoryboards() {
    toast.info("正在生成分镜，请稍候...");
    const res = await fetch(`/api/projects/${id}/generate-storyboards`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "生成分镜失败");
      return;
    }
    toast.success("分镜生成完成");
    mutate();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{project.name}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {project.creationMode === "MANUAL" && (
                <Badge variant="outline">手动分镜</Badge>
              )}
              <Badge variant="secondary">
                {statusLabels[project.status] || project.status}
              </Badge>
              {isLocked && (
                <Badge variant="destructive" title={project.lockedReason}>🔒 已锁定</Badge>
              )}
              {isViewer && !isLocked && (
                <Badge variant="outline">👁 只读</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">风格：</span>
              {project.style}
            </div>
            <div>
              <span className="text-muted-foreground">画幅：</span>
              {project.ratio}
            </div>
            <div>
              <span className="text-muted-foreground">分辨率：</span>
              {project.resolution}
            </div>
            <div>
              <span className="text-muted-foreground">Seed：</span>
              {project.globalSeed}
            </div>
          </div>
        </CardContent>
      </Card>

      {budgets && budgets.length > 0 && (
        <SeedanceBudgetBar budgets={budgets} />
      )}

      {/* Canvas 入口（仅 series 项目展示） */}
      {project.seriesId && (
        <SeriesCanvasLauncher seriesId={project.seriesId} readOnly={isReadOnly} />
      )}

      <Separator />

      {!isReadOnly && !["GENERATING_STORYBOARDS", "GENERATING_VIDEOS"].includes(project.status) && (
        <ManualProjectPanel
          project={project}
          onUpdate={mutate}
          creationMode={project.creationMode}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">分镜管理</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await mutate();
              setRefreshing(false);
              toast.success("已刷新");
            }}
          >
            {refreshing ? "刷新中..." : "刷新状态"}
          </Button>
          {!isReadOnly && project.creationMode !== "MANUAL" &&
            ["DRAFT", "FAILED", "REVIEW", "COMPLETED"].includes(
              project.status
            ) && (
              <Button
                onClick={handleGenerateStoryboards}
                variant="outline"
              >
                {project.storyboards && project.storyboards.length > 0
                  ? "重新生成分镜"
                  : "生成分镜"}
              </Button>
            )}
        </div>
      </div>

      {project.status === "GENERATING_STORYBOARDS" && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mb-2 text-lg">正在调用 Gemini 生成分镜...</div>
              <div className="text-sm text-muted-foreground">
                通常需要 30-60 秒，请耐心等待
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {project.storyboards && project.storyboards.length > 0 && (
        <StoryboardTable
          projectId={id}
          storyboards={project.storyboards}
          projectStatus={project.status}
          onUpdate={mutate}
          readOnly={isReadOnly}
          inSeries={!!project.seriesId}
          seriesId={project.seriesId ?? null}
        />
      )}

      {project.creationMode === "MANUAL" &&
        project.storyboards?.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <p>尚未添加分镜</p>
              <p className="text-sm">
                在「手动项目设置」卡片中点击「添加分镜（自动编号）」创建 s001
              </p>
            </CardContent>
          </Card>
        )}

      {project.creationMode !== "MANUAL" &&
        project.storyboards?.length === 0 &&
        !["DRAFT", "GENERATING_STORYBOARDS", "FAILED"].includes(
          project.status
        ) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <p>尚未有分镜</p>
              <p className="text-sm">
                可点击「重新生成分镜」自动生成，或在上方「项目信息编辑」卡片中点击「添加分镜（自动编号）」手动创建
              </p>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
