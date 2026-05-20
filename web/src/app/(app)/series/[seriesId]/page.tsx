import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeriesCanvasLauncher } from "@/components/series-canvas-launcher";
import { SeriesBudgetCard } from "@/components/series-budget-card";
import { SeriesOwnerActions } from "@/components/series-owner-actions";
import { SeriesSettingsCard } from "@/components/series-settings-card";
import { SeedanceBudgetBar, type BudgetEntry } from "@/components/seedance-budget-bar";

const roleLabel: Record<string, string> = {
  OWNER: "导演",
  PRODUCER: "制作者",
  VIEWER: "只读",
};

const episodeStatusLabel: Record<string, string> = {
  DRAFT: "草稿",
  GENERATING_STORYBOARDS: "生成分镜中",
  REVIEW: "待审核",
  GENERATING_VIDEOS: "生成视频中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

function formatEpisodeTitle(episode: {
  name: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
}) {
  if (episode.episodeNumber == null && !episode.episodeTitle) {
    return episode.name;
  }
  if (episode.episodeTitle) {
    return `第 ${episode.episodeNumber ?? "-"} 集${
      episode.episodeTitle !== `第 ${episode.episodeNumber} 集`
        ? ` · ${episode.episodeTitle}`
        : ""
    }`;
  }
  return `第 ${episode.episodeNumber ?? "-"} 集`;
}

export default async function SeriesDetailPage(
  props: { params: Promise<{ seriesId: string }> },
) {
  const { seriesId } = await props.params;
  const session = await auth();
  if (!session?.user) notFound();
  const m = await getMembership(session.user.id, seriesId);
  if (!m) notFound();

  const [series, episodes, budgets, allocations] = await Promise.all([
    prisma.series.findUnique({ where: { id: seriesId } }),
    prisma.project.findMany({
      where: { seriesId },
      orderBy: [{ episodeNumber: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { storyboards: true } } },
    }),
    prisma.seriesResourceBudget.findMany({
      where: { seriesId },
      orderBy: [{ budgetScope: "asc" }, { modelKey: "asc" }],
    }),
    prisma.projectResourceAllocation.findMany({ where: { seriesId } }),
  ]);

  // Build lookup: episodeId -> budgetId -> allocation
  const allocByEpisodeBudget = new Map<string, Map<string, typeof allocations[number]>>();
  for (const a of allocations) {
    if (!allocByEpisodeBudget.has(a.projectId)) {
      allocByEpisodeBudget.set(a.projectId, new Map());
    }
    allocByEpisodeBudget.get(a.projectId)!.set(a.seriesBudgetId, a);
  }

  // TOKEN-only budgets for episode cards
  const tokenBudgets = budgets.filter(
    (b) => b.metricType === "TOKEN" && !(b.provider === "canvas" && b.modelKey === "*"),
  );
  if (!series) notFound();

  const owner = series.ownerId
    ? await prisma.user.findUnique({
        where: { id: series.ownerId },
        select: { id: true, name: true, email: true },
      })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{series.name}</h1>
          <Badge variant="outline">{roleLabel[m.role] ?? m.role}</Badge>
          <Badge variant={series.status === "ACTIVE" ? "secondary" : "outline"}>
            {series.status}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          导演：{owner?.name || owner?.email || "—"}
        </p>
        {series.description && (
          <p className="mt-2 max-w-3xl text-sm">{series.description}</p>
        )}
      </div>

      <SeriesSettingsCard
        seriesId={seriesId}
        canEdit={m.role === "OWNER"}
        defaults={{
          defaultStyle: series.defaultStyle ?? "",
          defaultRatio: series.defaultRatio ?? "9:16",
          defaultResolution: series.defaultResolution ?? "720p",
          defaultSeed: series.defaultSeed ?? 0,
        }}
      />

      <div>
        <h2 className="mb-3 text-lg font-semibold">集数</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map((p) => {
            const locked = !!p.lockedReason;
            const episodeAllocMap = allocByEpisodeBudget.get(p.id);
            const episodeBudgets: BudgetEntry[] = tokenBudgets.map((b) => {
              const alloc = episodeAllocMap?.get(b.id) ?? null;
              return {
                budgetId: b.id,
                provider: b.provider,
                modelKey: b.modelKey,
                budgetScope: b.budgetScope,
                status: b.status,
                series: {
                  totalBudget: b.totalBudget.toString(),
                  committedUsage: b.committedUsage.toString(),
                  reservedUsage: b.reservedUsage.toString(),
                  unallocatedBudget: b.unallocatedBudget.toString(),
                },
                episode: alloc
                  ? {
                      allocatedBudget: alloc.allocatedBudget.toString(),
                      committedUsage: alloc.committedUsage.toString(),
                      reservedUsage: alloc.reservedUsage.toString(),
                    }
                  : null,
              };
            });
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {formatEpisodeTitle(p)}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-1">
                        {locked && <Badge variant="outline">已锁定</Badge>}
                        <Badge variant="secondary">
                          {episodeStatusLabel[p.status] ?? p.status}
                        </Badge>
                        {m.role === "OWNER" && (
                          <SeriesOwnerActions
                            seriesId={seriesId}
                            projectId={p.id}
                            locked={locked}
                            lockedReason={p.lockedReason}
                          />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {p._count.storyboards} 个分镜
                    </p>
                    {episodeBudgets.length > 0 && (
                      <SeedanceBudgetBar budgets={episodeBudgets} compact />
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">画布</h2>
        <SeriesCanvasLauncher seriesId={seriesId} readOnly={m.role === "VIEWER"} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">资源预算</h2>
        {budgets.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              未配置预算。请联系 Admin 配置。
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {budgets.map((b) => (
              <SeriesBudgetCard
                key={b.id}
                seriesId={seriesId}
                budget={{
                  id: b.id,
                  provider: b.provider,
                  modelKey: b.modelKey,
                  budgetScope: b.budgetScope,
                  metricType: b.metricType,
                  totalBudget: b.totalBudget.toString(),
                  committedUsage: b.committedUsage.toString(),
                  reservedUsage: b.reservedUsage.toString(),
                  unallocatedBudget: b.unallocatedBudget.toString(),
                  status: b.status,
                }}
                episodes={episodes.map((p) => ({
                  id: p.id,
                  episodeNumber: p.episodeNumber,
                  episodeTitle: p.episodeTitle,
                  name: p.name,
                }))}
                canAllocate={m.role === "OWNER"}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
