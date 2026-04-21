import request from "./request";
export const getPrompts = () => request.get("/prompts");
export const getPrompt = (id) => request.get(`/prompts/${id}`);
export const createPrompt = (data) => request.post("/prompts", data);
export const updatePrompt = (id, data) => request.patch(`/prompts/${id}`, data);
export const publishPrompt = (id) => request.post(`/prompts/${id}/publish`);
export const rollbackPrompt = (id, version) => request.post(`/prompts/${id}/rollback/${version}`);
export const getPromptVersions = (id) => request.get(`/prompts/${id}/versions`);
