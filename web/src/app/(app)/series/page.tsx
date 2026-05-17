import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const seriesStatusLabel: Record<string, string> = {
  ACTIVE: "进行中",
  LOCKED: "锁定",
  OVER_BUDGET: "超预算",
  ARCHIVED: "已归档",
};

const roleLabel: Record<string, string> = {
  OWNER: "导演",
  PRODUCER: "制作者",
  VIEWER: "只读",
};

export default async function MySeriesPage() {
  const session = await auth();
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session!.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  const seriesIds = memberships.map((m) => m.seriesId);
  if (seriesIds.length === 0) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">我的项目</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            你还没有被分配到任何 Series 项目。请联系管理员将你加入项目组。
          </CardContent>
        </Card>
      </div>
    );
  }
  const [series, episodeCounts] = await Promise.all([
    prisma.series.findMany({
      where: { id: { in: seriesIds } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.groupBy({
      by: ["seriesId"],
      where: { seriesId: { in: seriesIds } },
      _count: { id: true },
    }),
  ]);
  const eMap = new Map(episodeCounts.map((e) => [e.seriesId, e._count.id]));
  const roleMap = new Map(memberships.map((m) => [m.seriesId, m.role]));

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">我的项目</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((s) => (
          <Link key={s.id} href={`/series/${s.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{s.name}</CardTitle>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge variant="outline">
                      {roleLabel[roleMap.get(s.id) ?? ""] ?? roleMap.get(s.id)}
                    </Badge>
                    <Badge variant={s.status === "ACTIVE" ? "secondary" : "outline"}>
                      {seriesStatusLabel[s.status] ?? s.status}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  {eMap.get(s.id) ?? 0} 集 · 创建 {s.createdAt.toLocaleDateString("zh-CN")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {s.description || "（无描述）"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
