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
  BUDGET_SCOPE_VIDEO,
  METRIC_TOKEN,
} from "@/lib/series-budget";
import {
  resolveStoryboardAssetsForSeedance,
  StoryboardResolveError,
} from "@/lib/storyboard-asset-resolver";

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
          id: true,
          userId: true,
          seriesId: true,
          style: true,
          ratio: true,
          resolution: true,
          globalSeed: true,
          seedanceEndpoint: true,
          lockedReason: true,
        },
      },
    },
  });

  if (!storyboard) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }

  // v1.9.0：Series 成员鉴权 + 集数锁定检查
  try {
    await assertEpisodeAccess(session.user.id, storyboard.project.id, "write");
  } catch (e) {
    if (e instanceof SeriesAccessError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }

  // v1.9.1：Series 项目必须先由导演配置风格/画幅/分辨率
  if (storyboard.project.seriesId) {
    const missing: string[] = [];
    if (!storyboard.project.style || !storyboard.project.style.trim()) missing.push("风格");
    if (!storyboard.project.ratio || !storyboard.project.ratio.trim()) missing.push("画幅");
    if (!storyboard.project.resolution || !storyboard.project.resolution.trim()) missing.push("分辨率");
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

    const seed = resolveStoryboardSeed(storyboard.seed, storyboard.project.globalSeed);

    // v1.9.0：Seedance Token 预估
    const modelKey =
      userConfig?.model ||
      process.env.SEEDANCE_ENDPOINT ||
      process.env.SEEDANCE_MODEL ||
      "";
    const frameRate = await getDefaultFrameRate();
    const { snapshot, finalEstimateTokens } = await buildSeedanceEstimateSnapshot({
      modelKey,
      outputVideoDuration: storyboard.duration,
      ratio: storyboard.project.ratio,
      resolution: storyboard.project.resolution,
      frameRate,
    });

    // v1.9.0：若该 Project 归属 Series，则做预算检查 + 预扣
    let budgetCtx: {
      seriesId: string;
      budgetId: string;
      reservedAmount: bigint;
      projectAllocationId: string | null;
    } | null = null;

    if (storyboard.project.seriesId) {
      const seriesId = storyboard.project.seriesId;
      const budget = await findBudget(prisma, {
        seriesId,
        provider: "seedance",
        modelKey,
        budgetScope: BUDGET_SCOPE_VIDEO,
        metricType: METRIC_TOKEN,
      });
      if (!budget) {
        return NextResponse.json(
          {
            error: `项目未配置 Seedance ${modelKey} 预算，请联系 Admin 配置`,
            code: "BUDGET_NOT_CONFIGURED",
          },
          { status: 503 },
        );
      }
      if (budget.status !== "ACTIVE") {
        return NextResponse.json(
          { error: `预算已 ${budget.status}`, code: "BUDGET_NOT_ACTIVE" },
          { status: 423 },
        );
      }
      const available = getAvailableTokens(budget);
      if (available < finalEstimateTokens) {
        return NextResponse.json(
          {
            error: `Seedance 预算不足：可用 ${available}，需要 ${finalEstimateTokens}。请联系导演调配 buffer 或联系 Admin 增加预算`,
            code: "BUDGET_EXCEEDED",
            available: available.toString(),
            required: finalEstimateTokens.toString(),
          },
          { status: 429 },
        );
      }
      // 若启用集数级分配，再校验一次
      const allocation = await prisma.projectResourceAllocation.findUnique({
        where: { seriesBudgetId_projectId: { seriesBudgetId: budget.id, projectId: storyboard.project.id } },
      });
      if (allocation) {
        const epAvailable = allocation.allocatedBudget - allocation.committedUsage - allocation.reservedUsage;
        if (epAvailable < finalEstimateTokens) {
          return NextResponse.json(
            {
              error: `本集预算不足：可用 ${epAvailable}，需要 ${finalEstimateTokens}。请联系导演调配 buffer`,
              code: "EPISODE_BUDGET_EXCEEDED",
            },
            { status: 429 },
          );
        }
      }

      // 事务：预扣 + 创建 TokenUsageLog placeholder
      budgetCtx = {
        seriesId,
        budgetId: budget.id,
        reservedAmount: finalEstimateTokens,
        projectAllocationId: allocation?.id ?? null,
      };
      await prisma.$transaction(async (tx) => {
        await reserveTokens(tx, budget, finalEstimateTokens, {
          operatorId: session.user!.id,
          operatorRole: "PRODUCER",
          projectId: storyboard.project.id,
          projectAllocationId: allocation?.id ?? null,
          reason: "Seedance 提交预扣",
          metadata: { storyboardId: id, modelKey },
        });
      });
    }

    // v2.0.0：新链路（generationMode + assetRefs）优先；老数据回退用 seedanceContentItems
    let contentItems: object[];
    if (storyboard.generationMode && storyboard.assetRefs) {
      try {
        const resolved = await resolveStoryboardAssetsForSeedance(id);
        contentItems = resolved.contentItems.map((c) => c.payload);
      } catch (resolveErr) {
        // 释放预扣
        if (budgetCtx) {
          const { releaseTokenUsage, findBudgetById } = await import("@/lib/series-budget");
          const b = await findBudgetById(prisma, budgetCtx.budgetId);
          if (b) {
            await prisma.$transaction(async (tx) => {
              await releaseTokenUsage(tx, b, budgetCtx!.reservedAmount, {
                operatorId: session.user!.id,
                operatorRole: "SYSTEM",
                projectId: storyboard.project.id,
                projectAllocationId: budgetCtx!.projectAllocationId,
                reason: "资产校验失败释放预扣",
              });
            });
          }
        }
        if (resolveErr instanceof StoryboardResolveError) {
          return NextResponse.json(
            { error: resolveErr.message, code: resolveErr.code },
            { status: resolveErr.status },
          );
        }
        throw resolveErr;
      }
    } else {
      // legacy 老数据透传
      contentItems = storyboard.seedanceContentItems as object[];
    }

    let result: Awaited<ReturnType<typeof createSeedanceTask>> | null = null;
    try {
      result = await createSeedanceTask({
        prompt: storyboard.prompt,
        contentItems,
        duration: storyboard.duration,
        ratio: storyboard.project.ratio,
        resolution: storyboard.project.resolution,
        seed,
        // v2.0.0：开启尾帧返回，便于 Worker 自动资产化尾帧
        returnLastFrame: true,
      }, config);
    } catch (callErr) {
      // 调用失败：释放预扣
      if (budgetCtx) {
        const { releaseTokenUsage, findBudgetById } = await import("@/lib/series-budget");
        const b = await findBudgetById(prisma, budgetCtx.budgetId);
        if (b) {
          await prisma.$transaction(async (tx) => {
            await releaseTokenUsage(tx, b, budgetCtx!.reservedAmount, {
              operatorId: session.user!.id,
              operatorRole: "SYSTEM",
              projectId: storyboard.project.id,
              projectAllocationId: budgetCtx!.projectAllocationId,
              reason: "Seedance 调用失败释放预扣",
            });
          });
        }
      }
      throw callErr;
    }

    const createdTask = await prisma.generationTask.create({
      data: {
        storyboardId: id,
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
      where: { id },
      data: { status: "SUBMITTED" },
    });

    // 落 TokenUsageLog placeholder（RESERVED）；Worker 完成后会 update 为 FINALIZED
    if (budgetCtx) {
      try {
        await prisma.tokenUsageLog.create({
          data: {
            userId: session.user.id,
            projectId: storyboard.project.id,
            taskId: createdTask.id,
            provider: "seedance",
            model: createdTask.model,
            requestType: "video_generation",
            seriesId: budgetCtx.seriesId,
            seriesBudgetId: budgetCtx.budgetId,
            storyboardId: id,
            generationTaskId: createdTask.id,
            metricType: METRIC_TOKEN,
            budgetScope: BUDGET_SCOPE_VIDEO,
            actualCallType: "video",
            estimateTokens: budgetCtx.reservedAmount,
            reservedAmount: budgetCtx.reservedAmount,
            status: "RESERVED",
            metadata: snapshot,
            idempotencyKey: `seedance:${result.id}`,
          },
        });
      } catch (logErr) {
        console.error("[submit-storyboard] tokenUsageLog placeholder failed:", logErr);
      }
    }

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
        model: createdTask.model,
        submitMode: "single",
        seed,
        estimateTokens: snapshot.finalEstimateTokens,
        seriesId: storyboard.project.seriesId,
      },
    });

    console.log(
      `[submit-storyboard] storyboard=${id} arkTask=${result.id} estimate=${snapshot.finalEstimateTokens}`
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
