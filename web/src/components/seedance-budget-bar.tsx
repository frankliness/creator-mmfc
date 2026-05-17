"use client";

export type BudgetEntry = {
  budgetId: string;
  provider: string;
  modelKey: string;
  budgetScope: string;
  status: string;
  series: {
    totalBudget: string;
    committedUsage: string;
    reservedUsage: string;
    unallocatedBudget: string;
  };
  episode: {
    allocatedBudget: string;
    committedUsage: string;
    reservedUsage: string;
  } | null;
};

type Props = {
  budgets: BudgetEntry[];
  compact?: boolean;
};

function fmt(n: string | number): string {
  return Number(n).toLocaleString();
}

function barColor(pct: number, status: string): string {
  if (status === "OVERRUN" || pct >= 95) return "#ef4444"; // red
  if (pct >= 80) return "#eab308"; // yellow
  return "#22c55e"; // green
}

function BudgetRow({ entry, compact }: { entry: BudgetEntry; compact: boolean }) {
  const hasEpisode = !!entry.episode;

  const usedNum = hasEpisode
    ? Number(entry.episode!.committedUsage)
    : Number(entry.series.committedUsage);
  const totalNum = hasEpisode
    ? Number(entry.episode!.allocatedBudget)
    : Number(entry.series.totalBudget);

  const pct = totalNum > 0 ? Math.min(100, (usedNum / totalNum) * 100) : 0;
  const color = barColor(pct, entry.status);

  const label = `${entry.provider} · ${entry.modelKey}`;

  const subtitle = hasEpisode
    ? `已消耗 ${fmt(entry.episode!.committedUsage)} / 已分配 ${fmt(entry.episode!.allocatedBudget)}（Series 总 ${fmt(entry.series.totalBudget)}）`
    : `已消耗 ${fmt(entry.series.committedUsage)} / Series 总 ${fmt(entry.series.totalBudget)}（集数无单独分配）`;

  if (compact) {
    return (
      <div className="mt-1">
        <div className="flex items-center gap-1">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-xs text-muted-foreground" style={{ minWidth: 32 }}>
            {pct.toFixed(0)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function SeedanceBudgetBar({ budgets, compact = false }: Props) {
  if (budgets.length === 0) return null;

  if (compact) {
    return (
      <div className="mt-1 space-y-1">
        {budgets.map((b) => (
          <BudgetRow key={b.budgetId} entry={b} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <p className="text-sm font-semibold">Seedance Token 配额</p>
      {budgets.map((b) => (
        <BudgetRow key={b.budgetId} entry={b} compact={false} />
      ))}
    </div>
  );
}
