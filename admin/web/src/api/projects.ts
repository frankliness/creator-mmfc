import request from "./request";

export const getProjects = (params?: Record<string, unknown>) =>
  request.get("/projects", { params });

export const getProject = (id: string) => request.get(`/projects/${id}`);

export const deleteProject = (id: string) => request.delete(`/projects/${id}`);
