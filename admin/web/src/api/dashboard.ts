import request from "./request";

export const getOverview = () => request.get("/dashboard/overview");
export const getTrends = (days = 30) => request.get("/dashboard/trends", { params: { days } });
export const getTaskStats = () => request.get("/dashboard/task-stats");
