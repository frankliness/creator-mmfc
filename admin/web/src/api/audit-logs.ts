import request from "./request";

export const getAuditLogs = (params?: Record<string, unknown>) =>
  request.get("/audit-logs", { params });
