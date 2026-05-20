import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/series-membership";
import { Badge } from "@/components/ui/badge";
import { SeriesAssetLibrary } from "@/components/series-asset-library";

export default async function SeriesAssetsPage(
  props: { params: Promise<{ seriesId: string }> },
) {
  const { seriesId } = await props.params;
  const session = await auth();
  if (!session?.user) notFound();
  const m = await getMembership(session.user.id, seriesId);
  if (!m) notFound();
  const [series, group] = await Promise.all([
    prisma.series.findUnique({ where: { id: seriesId } }),
    prisma.seriesAssetGroup.findUnique({ where: { seriesId } }),
  ]);
  if (!series) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/series/${seriesId}`} className="text-sm text-muted-foreground hover:underline">
          ← 返回 {series.name}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold">素材库</h1>
          {group ? (
            <Badge variant={group.status === "ACTIVE" ? "secondary" : "destructive"}>
              Group: {group.status === "ACTIVE" ? group.groupName : group.status}
            </Badge>
          ) : (
            <Badge variant="outline">未绑定 Asset Group</Badge>
          )}
        </div>
        {!group || group.status !== "ACTIVE" ? (
          <p className="mt-2 text-sm text-amber-600">
            ⚠ Series 尚未绑定有效的 BytePlus Asset Group。可以上传到 OSS，但无法同步到 BytePlus、无法在分镜中引用。请联系 Admin 在后台绑定 Group。
          </p>
        ) : null}
      </div>

      <SeriesAssetLibrary
        seriesId={seriesId}
        canWrite={m.role !== "VIEWER"}
        groupActive={group?.status === "ACTIVE"}
      />
    </div>
  );
}
