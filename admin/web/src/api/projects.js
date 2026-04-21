import request from "./request";
export const getProjects = (params) => request.get("/projects", { params });
export const getProject = (id) => request.get(`/projects/${id}`);
export const deleteProject = (id) => request.delete(`/projects/${id}`);
