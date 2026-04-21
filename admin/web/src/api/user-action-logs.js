import request from "./request";
export const getUserActionLogs = (params) => request.get("/user-action-logs", { params });
