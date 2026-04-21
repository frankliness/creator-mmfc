import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSeedanceTask, type ApiConfig } from "@/lib/seedance";
import { decrypt } from "@/lib/crypto";
import { logUserAction } from "@/lib/user-action-logger";

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

  const body = await req.json();
  const storyboardIds: string[] = body.storyboardIds;

  if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
    return NextResponse.json({ error: "请选择分镜" }, { status: 400 });
  }

  const storyboards = await prisma.storyboard.findMany({
    where: {
      id: { in: storyboardIds },
      projectId,
      status: { in: ["DRAFT", "FAILED", "APPROVED"] },
    },
  });

  if (storyboards.length === 0) {
    return NextResponse.json(
      { error: "没有可提交的分镜" },
      { status: 400 }
    );
  }

  const userConfig = await prisma.userApiConfig.findFirst({
    where: { userId: session.user.id, provider: "seedance", isDefault: true, isActive: true },
  });
  let config: ApiConfig | undefined;
  let apiConfigId: string | null = null;
  if (userConfig) {
    config = { apiKey: decrypt(userConfig.apiKey), endpoint: userConfig.endpoint, model: userConfig.model || "" };
    apiConfigId = userConfig.id;
  }

  const results: { storyboardId: string; taskId?: string; error?: string }[] = [];

  for (const sb of storyboards) {
    try {
      const result = await createSeedanceTask({
        prompt: sb.prompt,
        contentItems: sb.seedanceContentItems as object[],
        duration: sb.duration,
        ratio: project.ratio,
        resolution: project.resolution,
        seed: project.globalSeed,
      }, config);

      const createdTask = await prisma.generationTask.create({
        data: {
          storyboardId: sb.id,
          arkTaskId: result.id,
          model: result.model || process.env.SEEDANCE_ENDPOINT || process.env.SEEDANCE_MODEL || "",
          status: "SUBMITTED",
          apiConfigId,
        },
      });

      await prisma.storyboard.update({
        where: { id: sb.id },
        data: { status: "SUBMITTED" },
      });

      await logUserAction({
        userId: session.user.id,
        category: "task",
        action: "task.submit",
        targetType: "GenerationTask",
        targetId: createdTask.id,
        projectId,
        storyboardId: sb.id,
        taskId: createdTask.id,
        route: `/api/projects/${projectId}/submit-batch`,
        metadata: {
          taskId: createdTask.id,
          arkTaskId: result.id,
          model: result.model || process.env.SEEDANCE_ENDPOINT || process.env.SEEDANCE_MODEL || "",
          submitMode: "batch",
        },
      });

      console.log(
        `[submit-batch] storyboard=${sb.id} arkTask=${result.id}`
      );

      results.push({ storyboardId: sb.id, taskId: createdTask.id });
    } catch (err) {
      console.error(`[submit-batch] storyboard=${sb.id} error:`, err);
      results.push({
        storyboardId: sb.id,
        error: err instanceof Error ? err.message : "提交失败",
      });
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "GENERATING_VIDEOS" },
  });

  await logUserAction({
    userId: session.user.id,
    category: "project",
    action: "project.submit_batch",
    targetType: "Project",
    targetId: projectId,
    projectId,
    route: `/api/projects/${projectId}/submit-batch`,
    metadata: {
      requested: storyboardIds.length,
      submitted: results.filter((item) => item.taskId).length,
      failed: results.filter((item) => item.error).length,
    },
  });

  return NextResponse.json({ results });
}
