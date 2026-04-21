import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getTaskStatus } from "../lib/seedance";
import {
  buildVideoBasename,
  downloadVideo,
  uploadToGCS,
} from "./video-persist";
import { logTokenUsage } from "../lib/token-logger";
import { decrypt } from "../lib/crypto";
import { logUserAction } from "../lib/user-action-logger";

const prisma = new PrismaClient();

const POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL || "15000");
const BATCH_SIZE = 20;

async function pollTasks() {
  const activeTasks = await prisma.generationTask.findMany({
    where: { status: { in: ["SUBMITTED", "RUNNING"] } },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
    include: {
      apiConfig: true,
      storyboard: {
        select: {
          id: true,
          storyboardId: true,
          project: { select: { id: true, userId: true } },
        },
      },
    },
  });

  if (activeTasks.length === 0) return;

  console.log(`[worker] polling ${activeTasks.length} active tasks`);

  for (const task of activeTasks) {
    try {
      let apiKey: string | undefined;
      if (task.apiConfig) {
        try {
          apiKey = decrypt(task.apiConfig.apiKey);
        } catch (decryptErr) {
          console.error(`[worker] Failed to decrypt API key for task ${task.arkTaskId}:`, decryptErr);
        }
      }

      const result = await getTaskStatus(task.arkTaskId, apiKey);

      if (result.status === "succeeded") {
        console.log(`[worker] task ${task.arkTaskId} succeeded`);

        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "SUCCEEDED",
            arkStatus: result.status,
            videoUrl: result.content?.video_url || null,
            seed: result.seed ? BigInt(result.seed) : null,
            resolution: result.resolution || null,
            ratio: result.ratio || null,
            duration: result.duration || null,
            completionTokens: result.usage?.completion_tokens
              ? BigInt(result.usage.completion_tokens)
              : null,
            totalTokens: result.usage?.total_tokens
              ? BigInt(result.usage.total_tokens)
              : null,
          },
        });

        await logUserAction({
          userId: task.storyboard.project.userId,
          category: "task",
          action: "task.succeeded",
          targetType: "GenerationTask",
          targetId: task.id,
          projectId: task.storyboard.project.id,
          storyboardId: task.storyboardId,
          taskId: task.id,
          metadata: {
            arkTaskId: task.arkTaskId,
            model: task.model,
            totalTokens: String(result.usage?.total_tokens || 0),
          },
        });

        if (result.usage) {
          await logTokenUsage({
            userId: task.storyboard.project.userId,
            projectId: task.storyboard.project.id,
            taskId: task.id,
            provider: "seedance",
            model: task.model,
            requestType: "video_generation",
            outputTokens: BigInt(result.usage.completion_tokens || 0),
            totalTokens: BigInt(result.usage.total_tokens || 0),
          });
        }

        await prisma.storyboard.update({
          where: { id: task.storyboardId },
          data: { status: "SUCCEEDED" },
        });

        if (result.content?.video_url) {
          persistVideo(
            task.id,
            task.arkTaskId,
            task.storyboard.storyboardId,
            result.content.video_url
          );
        }
      } else if (result.status === "failed") {
        const errorMsg =
          result.error?.message || result.error?.code || "unknown";
        console.error(`[worker] task ${task.arkTaskId} failed: ${errorMsg}`);

        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            arkStatus: result.status,
            error: errorMsg,
          },
        });

        await logUserAction({
          userId: task.storyboard.project.userId,
          category: "task",
          action: "task.failed",
          targetType: "GenerationTask",
          targetId: task.id,
          projectId: task.storyboard.project.id,
          storyboardId: task.storyboardId,
          taskId: task.id,
          metadata: {
            arkTaskId: task.arkTaskId,
            error: errorMsg,
          },
        });

        await prisma.storyboard.update({
          where: { id: task.storyboardId },
          data: { status: "FAILED" },
        });
      } else {
        if (task.status !== "RUNNING") {
          await prisma.generationTask.update({
            where: { id: task.id },
            data: { status: "RUNNING", arkStatus: result.status },
          });

          await logUserAction({
            userId: task.storyboard.project.userId,
            category: "task",
            action: "task.running",
            targetType: "GenerationTask",
            targetId: task.id,
            projectId: task.storyboard.project.id,
            storyboardId: task.storyboardId,
            taskId: task.id,
            metadata: {
              arkTaskId: task.arkTaskId,
              arkStatus: result.status,
            },
          });

          await prisma.storyboard.update({
            where: { id: task.storyboardId },
            data: { status: "GENERATING" },
          });
        }
      }
    } catch (err) {
      console.error(
        `[worker] error polling task ${task.arkTaskId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function persistVideo(
  taskId: string,
  arkTaskId: string,
  storyboardIdLabel: string,
  videoUrl: string
) {
  try {
    const task = await prisma.generationTask.findUnique({
      where: { id: taskId },
      select: {
        storyboardId: true,
        storyboard: {
          select: {
            project: {
              select: {
                id: true,
                userId: true,
              },
            },
          },
        },
      },
    });
    if (!task) return;

    await prisma.generationTask.update({
      where: { id: taskId },
      data: { status: "PERSISTING" },
    });

    await logUserAction({
      userId: task.storyboard.project.userId,
      category: "task",
      action: "task.persisting",
      targetType: "GenerationTask",
      targetId: taskId,
      projectId: task.storyboard.project.id,
      storyboardId: task.storyboardId,
      taskId,
      metadata: {
        arkTaskId,
      },
    });

    const videoBasename = buildVideoBasename(storyboardIdLabel, arkTaskId);
    const localPath = await downloadVideo(videoUrl, videoBasename);
    let gcsPath: string | null = null;

    if (process.env.GCS_BUCKET && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        gcsPath = await uploadToGCS(localPath, videoBasename, {
          storyboardId: storyboardIdLabel,
          arkTaskId,
        });
      } catch (gcsErr) {
        console.error(
          `[worker] GCS upload failed for ${storyboardIdLabel}/${arkTaskId}:`,
          gcsErr instanceof Error ? gcsErr.message : gcsErr
        );
      }
    }

    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "PERSISTED",
        localVideoPath: localPath,
        gcsVideoPath: gcsPath,
        error: null,
      },
    });

    await logUserAction({
      userId: task.storyboard.project.userId,
      category: "task",
      action: "task.persisted",
      targetType: "GenerationTask",
      targetId: taskId,
      projectId: task.storyboard.project.id,
      storyboardId: task.storyboardId,
      taskId,
      metadata: {
        arkTaskId,
        localPath,
        gcsPath,
      },
    });

    console.log(
      `[worker] video persisted for ${arkTaskId}: local=${localPath}${gcsPath ? ` gcs=${gcsPath}` : ""}`
    );
  } catch (err) {
    console.error(
      `[worker] persist error for ${arkTaskId}:`,
      err instanceof Error ? err.message : err
    );
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        error: `持久化失败: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
}

async function checkProjectCompletion() {
  const projects = await prisma.project.findMany({
    where: { status: "GENERATING_VIDEOS" },
    include: {
      storyboards: {
        where: { status: { in: ["SUBMITTED", "GENERATING"] } },
      },
    },
  });

  for (const project of projects) {
    if (project.storyboards.length === 0) {
      const allStoryboards = await prisma.storyboard.findMany({
        where: { projectId: project.id },
      });
      const allDone = allStoryboards.every((sb) =>
        ["SUCCEEDED", "FAILED", "DRAFT"].includes(sb.status)
      );
      if (allDone) {
        const hasFailure = allStoryboards.some((sb) => sb.status === "FAILED");
        await prisma.project.update({
          where: { id: project.id },
          data: { status: hasFailure ? "FAILED" : "COMPLETED" },
        });
        await logUserAction({
          userId: project.userId,
          category: "project",
          action: hasFailure ? "project.completed_with_failure" : "project.completed",
          targetType: "Project",
          targetId: project.id,
          projectId: project.id,
          metadata: {
            status: hasFailure ? "FAILED" : "COMPLETED",
          },
        });
        console.log(
          `[worker] project ${project.id} marked ${hasFailure ? "FAILED" : "COMPLETED"}`
        );
      }
    }
  }
}

async function retryPersist() {
  const tasks = await prisma.generationTask.findMany({
    where: {
      status: "SUCCEEDED",
      videoUrl: { not: null },
      localVideoPath: null,
    },
    take: 5,
    include: {
      storyboard: { select: { storyboardId: true } },
    },
  });

  for (const task of tasks) {
    if (task.videoUrl) {
      console.log(`[worker] retrying persist for ${task.arkTaskId}`);
      persistVideo(
        task.id,
        task.arkTaskId,
        task.storyboard.storyboardId,
        task.videoUrl
      );
    }
  }
}

async function mainLoop() {
  console.log(
    `[worker] started, poll interval=${POLL_INTERVAL}ms`
  );

  while (true) {
    try {
      await pollTasks();
      await retryPersist();
      await checkProjectCompletion();
    } catch (err) {
      console.error(
        "[worker] loop error:",
        err instanceof Error ? err.message : err
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

mainLoop().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
