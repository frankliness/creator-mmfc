import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const statusLabels: Record<string, string> = {
  DRAFT: "草稿",
  GENERATING_STORYBOARDS: "生成分镜中",
  REVIEW: "待审核",
  GENERATING_VIDEOS: "生成视频中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

export default async function DashboardPage() {
  const session = await auth();
  // v1.9.0：dashboard 只展示 legacy 自建 Project（seriesId=null）；归属 Series 的进入 /series。
  const projects = await prisma.project.findMany({
    where: { userId: session!.user.id, seriesId: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { storyboards: true } } },
  });
  const [user, gc] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { canSelfCreateProject: true },
    }),
    prisma.globalConfig.findUnique({ where: { key: "allow_user_self_create_project" } }),
  ]);
  const canSelfCreate = !!(user?.canSelfCreateProject || gc?.value === "true");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的旧项目</h1>
          <p className="text-sm text-muted-foreground">
            归属于 Series 项目集的集数请到 <Link href="/series" className="underline">我的项目</Link> 查看。
          </p>
        </div>
        {canSelfCreate && (
          <Link href="/projects/new">
            <Button>新建项目</Button>
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">这里没有 legacy 项目</p>
            {canSelfCreate ? (
              <Link href="/projects/new">
                <Button>创建第一个项目</Button>
              </Link>
            ) : (
              <Link href="/series">
                <Button variant="outline">前往 Series 项目</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {p.creationMode === "MANUAL" && (
                        <Badge variant="outline">手动</Badge>
                      )}
                      <Badge variant="secondary">
                        {statusLabels[p.status] || p.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    {p._count.storyboards} 个分镜 &middot;{" "}
                    {p.createdAt.toLocaleDateString("zh-CN")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {p.script?.trim()
                      ? `${p.script.slice(0, 120)}…`
                      : "（无剧本摘要）"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
