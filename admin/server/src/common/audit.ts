import { prisma } from "./prisma.js";

interface AuditParams {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export async function createAuditLog(params: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        before: params.before as object ?? undefined,
        after: params.after as object ?? undefined,
        ip: params.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] Failed to create audit log:", err);
  }
}
