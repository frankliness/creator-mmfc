import request from "./request";

export const getTasks = (params?: Record<string, unknown>) =>
  request.get("/tasks", { params });

export const getTask = (id: string) => request.get(`/tasks/${id}`);

export const retryTask = (id: string) => request.post(`/tasks/${id}/retry`);

export const getRealtimeStats = () => request.get("/tasks/realtime-stats");
