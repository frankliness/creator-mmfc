import request from "./request";
export const getTasks = (params) => request.get("/tasks", { params });
export const getTask = (id) => request.get(`/tasks/${id}`);
export const retryTask = (id) => request.post(`/tasks/${id}/retry`);
export const getRealtimeStats = () => request.get("/tasks/realtime-stats");
