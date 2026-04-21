import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSeedanceTask, type ApiConfig } from "@/lib/seedance";
import { decrypt } from "@/lib/crypto";
import { logUserAction } from "@/lib/user-action-logger";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id },
    include: {
      project: {
        select: {
          userId: true,
          ratio: true,
          resolution: true,
          globalSeed: true,
          seedanceEndpoint: true,
        },
      },
    },
  });

  if (!storyboard || storyboard.project.userId !== session.user.id) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }

  if (!["DRAFT", "FAILED", "APPROVED"].includes(storyboard.status)) {
    return NextResponse.json(
      { error: `分镜状态不允许提交: ${storyboard.status}` },
      { status: 400 }
    );
  }

  try {
    const userConfig = await prisma.userApiConfig.findFirst({
      where: { userId: session.user.id, provider: "seedance", isDefault: true, isActive: true },
    });
    let config: ApiConfig | undefined;
    let apiConfigId: string | null = null;
    if (userConfig) {
      config = { apiKey: decrypt(userConfig.apiKey), endpoint: userConfig.endpoint, model: userConfig.model || "" };
      apiConfigId = userConfig.id;
    }

    const result = await createSeedanceTask({
      prompt: storyboard.prompt,
      contentItems: storyboard.seedanceContentItems as object[],
      duration: storyboard.duration,
      ratio: storyboard.project.ratio,
      resolution: storyboard.project.resolution,
      seed: storyboard.project.globalSeed,
    }, config);

    const createdTask = await prisma.generationTask.create({
      data: {
        storyboardId: id,
        arkTaskId: result.id,
        model: result.model || process.env.SEEDANCE_ENDPOINT || process.env.SEEDANCE_MODEL || "",
        status: "SUBMITTED",
        apiConfigId,
      },
    });

    await prisma.storyboard.update({
      where: { id },
      data: { status: "SUBMITTED" },
    });

    await logUserAction({
      userId: session.user.id,
      category: "task",
      action: "task.submit",
      targetType: "GenerationTask",
      targetId: createdTask.id,
      projectId: storyboard.projectId,
      storyboardId: id,
      taskId: createdTask.id,
      route: `/api/storyboards/${id}/submit`,
      metadata: {
        taskId: createdTask.id,
        arkTaskId: result.id,
        model: result.model || process.env.SEEDANCE_ENDPOINT || process.env.SEEDANCE_MODEL || "",
        submitMode: "single",
      },
    });

    console.log(
      `[submit-storyboard] storyboard=${id} arkTask=${result.id}`
    );

    return NextResponse.json({ taskId: createdTask.id, arkTaskId: result.id });
  } catch (err) {
    console.error("[submit-storyboard] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "提交失败" },
      { status: 500 }
    );
  }
}
