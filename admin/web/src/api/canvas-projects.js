import request from "./request";
export const getCanvasProjects = (params) => request.get("/canvas-projects", { params });
export const getCanvasProject = (id) => request.get(`/canvas-projects/${id}`);
export const patchCanvasProject = (id, data) => request.patch(`/canvas-projects/${id}`, data);
export const deleteCanvasProject = (id) => request.delete(`/canvas-projects/${id}`);
