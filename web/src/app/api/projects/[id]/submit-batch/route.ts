import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSeedanceTask, type ApiConfig } from "@/lib/seedance";
import { decrypt } from "@/lib/crypto";
import { resolveStoryboardSeed } from "@/lib/storyboard-seed";
import { logUserAction } from "@/lib/user-action-logger";
import { assertEpisodeAccess, SeriesAccessError } from "@/lib/series-membership";
import {
  buildSeedanceEstimateSnapshot,
  getDefaultFrameRate,
} from "@/lib/seedance-pricing";
import {
  findBudget,
  getAvailableTokens,
  reserveTokens,
  releaseTokenUsage,
  findBudgetById,
  BUDGET_SCOPE_VIDEO,
  METRIC_TOKEN,
} from "@/lib/series-budget";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // v1.9.0：使用 assertEpisodeAccess 同时覆盖 legacy + Series 路径
  let projectAccess;
  try {
    projectAccess = await assertEpisodeAccess(session.user.id, projectId, "write");
  } catch (e) {
    if (e instanceof SeriesAccessError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // v1.9.1：Series 项目必须先由导演配置风格/画幅/分辨率
  if (project.seriesId) {
    const missing: string[] = [];
    if (!project.style || !project.style.trim()) missing.push("风格");
    if (!project.ratio || !project.ratio.trim()) missing.push("画幅");
    if (!project.resolution || !project.resolution.trim()) missing.push("分辨率");
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `请先联系导演在 Series 设置中配置：${missing.join("、")}`,
          code: "SERIES_DEFAULTS_MISSING",
        },
        { status: 400 }
      );
    }
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
  const modelKey =
    userConfig?.model ||
    process.env.SEEDANCE_ENDPOINT ||
    process.env.SEEDANCE_MODEL ||
    "";

  const frameRate = await getDefaultFrameRate();

  // v1.9.0：批量预估 + 预算预检
  type Snap = Awaited<ReturnType<typeof buildSeedanceEstimateSnapshot>>;
  const snapshots = new Map<string, Snap>();
  let totalEstimate = BigInt(0);
  for (const sb of storyboards) {
    const sn = await buildSeedanceEstimateSnapshot({
      modelKey,
      outputVideoDuration: sb.duration,
      ratio: project.ratio,
      resolution: project.resolution,
      frameRate,
    });
    snapshots.set(sb.id, sn);
    totalEstimate += sn.finalEstimateTokens;
  }

  let budgetMode: { seriesId: string; budgetId: string; projectAllocationId: string | null } | null = null;
  if (project.seriesId) {
    const budget = await findBudget(prisma, {
      seriesId: project.seriesId,
      provider: "seedance",
      modelKey,
      budgetScope: BUDGET_SCOPE_VIDEO,
      metricType: METRIC_TOKEN,
    });
    if (!budget) {
      return NextResponse.json(
        { error: `项目未配置 Seedance ${modelKey} 预算`, code: "BUDGET_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (budget.status !== "ACTIVE") {
      return NextResponse.json({ error: `预算 ${budget.status}`, code: "BUDGET_NOT_ACTIVE" }, { status: 423 });
    }
    const available = getAvailableTokens(budget);
    if (available < totalEstimate) {
      return NextResponse.json(
        {
          error: `批量 Seedance 预算不足：可用 ${available}，需要 ${totalEstimate}`,
          code: "BUDGET_EXCEEDED",
          available: available.toString(),
          required: totalEstimate.toString(),
        },
        { status: 429 },
      );
    }
    const allocation = await prisma.projectResourceAllocation.findUnique({
      where: { seriesBudgetId_projectId: { seriesBudgetId: budget.id, projectId } },
    });
    if (allocation) {
      const epAvailable = allocation.allocatedBudget - allocation.committedUsage - allocation.reservedUsage;
      if (epAvailable < totalEstimate) {
        return NextResponse.json(
          { error: `本集批量预算不足：可用 ${epAvailable}，需要 ${totalEstimate}`, code: "EPISODE_BUDGET_EXCEEDED" },
          { status: 429 },
        );
      }
    }
    budgetMode = {
      seriesId: project.seriesId,
      budgetId: budget.id,
      projectAllocationId: allocation?.id ?? null,
    };
  }

  const results: { storyboardId: string; taskId?: string; error?: string }[] = [];

  for (const sb of storyboards) {
    const snap = snapshots.get(sb.id)!;
    let reserved: bigint = BigInt(0);
    try {
      // 预扣（如果有 Series 预算）
      if (budgetMode) {
        const budget = await findBudgetById(prisma, budgetMode.budgetId);
        if (!budget) throw new Error("预算池在批量过程中消失");
        await prisma.$transaction(async (tx) => {
          await reserveTokens(tx, budget, snap.finalEstimateTokens, {
            operatorId: session.user!.id,
            operatorRole: "PRODUCER",
            projectId,
            projectAllocationId: budgetMode!.projectAllocationId,
            reason: "Seedance 批量提交预扣",
            metadata: { storyboardId: sb.id, modelKey },
          });
        });
        reserved = snap.finalEstimateTokens;
      }

      const seed = resolveStoryboardSeed(sb.seed, project.globalSeed);

      const result = await createSeedanceTask({
        prompt: sb.prompt,
        contentItems: sb.seedanceContentItems as object[],
        duration: sb.duration,
        ratio: project.ratio,
        resolution: project.resolution,
        seed,
      }, config);

      const createdTask = await prisma.generationTask.create({
        data: {
          storyboardId: sb.id,
          arkTaskId: result.id,
          model:
            result.requestedModel ||
            result.model ||
            modelKey,
          status: "SUBMITTED",
          apiConfigId,
          seed: BigInt(seed),
        },
      });

      await prisma.storyboard.update({
        where: { id: sb.id },
        data: { status: "SUBMITTED" },
      });

      // RESERVED placeholder log
      if (budgetMode) {
        try {
          await prisma.tokenUsageLog.create({
            data: {
              userId: session.user.id,
              projectId,
              taskId: createdTask.id,
              provider: "seedance",
              model: createdTask.model,
              requestType: "video_generation",
              seriesId: budgetMode.seriesId,
              seriesBudgetId: budgetMode.budgetId,
              storyboardId: sb.id,
              generationTaskId: createdTask.id,
              metricType: METRIC_TOKEN,
              budgetScope: BUDGET_SCOPE_VIDEO,
              actualCallType: "video",
              estimateTokens: snap.finalEstimateTokens,
              reservedAmount: snap.finalEstimateTokens,
              status: "RESERVED",
              metadata: snap.snapshot,
              idempotencyKey: `seedance:${result.id}`,
            },
          });
        } catch (logErr) {
          console.error("[submit-batch] tokenUsageLog placeholder failed:", logErr);
        }
      }

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
          model: createdTask.model,
          submitMode: "batch",
          seed,
          estimateTokens: snap.snapshot.finalEstimateTokens,
        },
      });

      console.log(`[submit-batch] storyboard=${sb.id} arkTask=${result.id}`);

      results.push({ storyboardId: sb.id, taskId: createdTask.id });
    } catch (err) {
      // 失败：释放预扣
      if (budgetMode && reserved > BigInt(0)) {
        try {
          const budget = await findBudgetById(prisma, budgetMode.budgetId);
          if (budget) {
            await prisma.$transaction(async (tx) => {
              await releaseTokenUsage(tx, budget, reserved, {
                operatorId: session.user!.id,
                operatorRole: "SYSTEM",
                projectId,
                projectAllocationId: budgetMode!.projectAllocationId,
                reason: "Seedance 批量调用失败释放",
              });
            });
          }
        } catch (releaseErr) {
          console.error("[submit-batch] release reserve failed:", releaseErr);
        }
      }
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
      seriesId: project.seriesId,
      totalEstimateTokens: totalEstimate.toString(),
    },
  });

  return NextResponse.json({ results });
}
