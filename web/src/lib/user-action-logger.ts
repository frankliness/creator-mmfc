import { prisma } from "./prisma";

interface UserActionParams {
  userId: string;
  category: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  projectId?: string | null;
  storyboardId?: string | null;
  taskId?: string | null;
  route?: string | null;
  metadata?: object;
}

export async function logUserAction(params: UserActionParams) {
  try {
    await prisma.userActionLog.create({
      data: {
        userId: params.userId,
        category: params.category,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        projectId: params.projectId ?? null,
        storyboardId: params.storyboardId ?? null,
        taskId: params.taskId ?? null,
        route: params.route ?? null,
        metadata: params.metadata as object ?? undefined,
      },
    });
  } catch (err) {
    console.error("[user-action-log] Failed to create log:", err);
  }
}
