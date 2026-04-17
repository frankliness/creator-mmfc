import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateStoryboards } from "@/lib/gemini";
import { logTokenUsage } from "@/lib/token-logger";

export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (project.creationMode === "MANUAL") {
    return NextResponse.json(
      { error: "手动分镜项目不支持 AI 生成分镜" },
      { status: 400 }
    );
  }

  try {
    await prisma.project.update({
      where: { id },
      data: { status: "GENERATING_STORYBOARDS" },
    });

    const { storyboards: results, usage, model } = await generateStoryboards({
      script: project.script,
      fullScript: project.fullScript,
      assets: JSON.stringify(project.assetsJson, null, 2),
      assetDescriptions: JSON.stringify(project.assetDescriptions, null, 2),
      style: project.style,
    });

    console.log(
      `[generate-storyboards] project=${id} storyboards=${results.length} tokens=${usage.totalTokenCount ?? 0}`
    );

    await logTokenUsage({
      userId: session.user.id,
      projectId: id,
      provider: "gemini",
      model,
      requestType: "storyboard_generation",
      inputTokens: BigInt(usage.promptTokenCount ?? 0),
      outputTokens: BigInt(usage.candidatesTokenCount ?? 0),
      totalTokens: BigInt(usage.totalTokenCount ?? 0),
      metadata: usage,
    });

    const existingRows = await prisma.storyboard.findMany({
      where: { projectId: id },
      select: { storyboardId: true, sortOrder: true },
    });

    let maxNum = 0;
    let maxSort = -1;
    for (const r of existingRows) {
      const m = r.storyboardId.match(/^s(\d{3})$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      maxSort = Math.max(maxSort, r.sortOrder);
    }

    console.log(
      `[generate-storyboards] project=${id} existing=${existingRows.length} newStart=s${String(maxNum + 1).padStart(3, "0")} sortStart=${maxSort + 1}`
    );

    await prisma.storyboard.createMany({
      data: results.map((sb, idx) => ({
        projectId: id,
        storyboardId: `s${String(maxNum + 1 + idx).padStart(3, "0")}`,
        sortOrder: maxSort + 1 + idx,
        duration: sb.duration,
        prompt: sb.prompt,
        assetBindings: sb.asset_bindings as object,
        seedanceContentItems: sb.seedance_content_items as object,
        status: "DRAFT",
      })),
    });

    await prisma.project.update({
      where: { id },
      data: { status: "REVIEW" },
    });

    return NextResponse.json({ count: results.length });
  } catch (err) {
    console.error("[generate-storyboards] error:", err);
    await prisma.project.update({
      where: { id },
      data: { status: "FAILED" },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败" },
      { status: 500 }
    );
  }
}
