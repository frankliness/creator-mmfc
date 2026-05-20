import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextSequentialStoryboardId } from "@/lib/storyboard-id";
import { isValidManualStoryboardDuration } from "@/lib/storyboard-duration";
import { MAX_STORYBOARD_SEED } from "@/lib/storyboard-seed";
import { logUserAction } from "@/lib/user-action-logger";
import { getMembership } from "@/lib/series-membership";
import { z } from "zod";

/** v2.0.0：新链路结构化资产引用 */
const assetRefsSchema = z.object({
  first_frame_asset_id: z.string().nullable().optional(),
  last_frame_asset_id: z.string().nullable().optional(),
  reference_image_asset_ids: z.array(z.string()).max(9).optional(),
  reference_video_asset_ids: z.array(z.string()).max(3).optional(),
  reference_audio_asset_id: z.string().nullable().optional(),
});

const createBodySchema = z.object({
  prompt: z.string().min(1, "提示词不能为空"),
  duration: z
    .number()
    .refine(isValidManualStoryboardDuration, "时长仅支持整数秒：4-15 或 -1"),
  /**
   * Legacy：手填 assetBindings，新创建分镜不再使用，但保留以向后兼容旧客户端。
   * 当 generationMode + assetRefs 提供时，本字段会被忽略并写空数组。
   */
  assetBindings: z.array(
    z.object({
      index_label: z.string(),
      asset_name: z.string(),
      asset_uri: z.string(),
    })
  ).optional(),
  /** v2.0.0：生成模式 FIRST_FRAME / MULTIMODAL */
  generationMode: z.enum(["FIRST_FRAME", "MULTIMODAL"]).optional(),
  /** v2.0.0：结构化资产引用 */
  assetRefs: assetRefsSchema.optional(),
  seed: z
    .number()
    .int()
    .min(1)
    .max(MAX_STORYBOARD_SEED)
    .nullable()
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (project.lockedReason) {
    return NextResponse.json({ error: "集数已锁定" }, { status: 423 });
  }
  // Check access: owner OR series OWNER/PRODUCER
  if (project.userId !== session.user.id) {
    if (!project.seriesId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const m = await getMembership(session.user.id, project.seriesId);
    if (!m || (m.role !== "OWNER" && m.role !== "PRODUCER")) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
  }

  const body = await req.json();
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 新链路：generationMode + assetRefs 优先；legacy 老客户端继续走 assetBindings/seedanceContentItems
  const useNewPath = !!(parsed.data.generationMode && parsed.data.assetRefs);
  const normalizedBindings = useNewPath
    ? []
    : (parsed.data.assetBindings ?? []).map((a) => ({
        ...a,
        asset_uri: a.asset_uri.startsWith("asset://")
          ? a.asset_uri
          : `asset://${a.asset_uri}`,
      }));

  const contentItems = useNewPath
    ? []
    : normalizedBindings.map((a) => ({
        type: "image_url" as const,
        image_url: { url: a.asset_uri },
        role: "reference_image" as const,
      }));

  const storyboardId = await nextSequentialStoryboardId(prisma, projectId);

  const maxSort = await prisma.storyboard.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const created = await prisma.storyboard.create({
    data: {
      projectId,
      storyboardId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      duration: parsed.data.duration,
      prompt: parsed.data.prompt,
      assetBindings: normalizedBindings,
      seedanceContentItems: contentItems,
      generationMode: useNewPath ? parsed.data.generationMode : null,
      assetRefs: useNewPath ? parsed.data.assetRefs : undefined,
      seed: parsed.data.seed ?? null,
      status: "DRAFT",
    },
  });

  console.log(`[manual-storyboard] project=${projectId} created ${storyboardId}`);

  await logUserAction({
    userId: session.user.id,
    category: "storyboard",
    action: "storyboard.create",
    targetType: "Storyboard",
    targetId: created.id,
    projectId,
    storyboardId: created.id,
    route: `/api/projects/${projectId}/storyboards`,
    metadata: {
      storyboardCode: created.storyboardId,
      duration: created.duration,
      seed: created.seed,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
