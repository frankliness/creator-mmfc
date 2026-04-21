import request from "./request";

export const getCanvasProjects = (params?: Record<string, unknown>) =>
  request.get("/canvas-projects", { params });

export const getCanvasProject = (id: string) => request.get(`/canvas-projects/${id}`);

export const patchCanvasProject = (id: string, data: { status: string }) =>
  request.patch(`/canvas-projects/${id}`, data);

export const deleteCanvasProject = (id: string) => request.delete(`/canvas-projects/${id}`);
