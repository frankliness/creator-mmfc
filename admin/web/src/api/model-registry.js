import request from "./request";
export const listModels = (category) => request.get("/model-registry", { params: category ? { category } : {} });
export const createModel = (data) => request.post("/model-registry", data);
export const updateModel = (id, data) => request.patch(`/model-registry/${id}`, data);
export const toggleModel = (id) => request.patch(`/model-registry/${id}/toggle`);
export const deleteModel = (id) => request.delete(`/model-registry/${id}`);
