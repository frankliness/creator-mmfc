import request from "./request";

export const getUserActionLogs = (params?: Record<string, unknown>) =>
  request.get("/user-action-logs", { params });
