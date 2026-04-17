import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextSequentialStoryboardId } from "@/lib/storyboard-id";
import { z } from "zod";

const createBodySchema = z.object({
  prompt: z.string().min(1, "提示词不能为空"),
  duration: z.number().int().min(10).max(15),
  assetBindings: z.array(
    z.object({
      index_label: z.string(),
      asset_name: z.string(),
      asset_uri: z.string(),
    })
  ),
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (project.creationMode !== "MANUAL") {
    return NextResponse.json(
      { error: "仅手动分镜项目可手动添加分镜" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const normalizedBindings = parsed.data.assetBindings.map((a) => ({
    ...a,
    asset_uri: a.asset_uri.startsWith("asset://")
      ? a.asset_uri
      : `asset://${a.asset_uri}`,
  }));

  const contentItems = normalizedBindings.map((a) => ({
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
      status: "DRAFT",
    },
  });

  console.log(`[manual-storyboard] project=${projectId} created ${storyboardId}`);

  return NextResponse.json(created, { status: 201 });
}
