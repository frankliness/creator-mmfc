import request from "./request";

export const getPrompts = () => request.get("/prompts");
export const getPrompt = (id: string) => request.get(`/prompts/${id}`);
export const createPrompt = (data: Record<string, unknown>) => request.post("/prompts", data);
export const updatePrompt = (id: string, data: Record<string, unknown>) => request.patch(`/prompts/${id}`, data);
export const publishPrompt = (id: string) => request.post(`/prompts/${id}/publish`);
export const rollbackPrompt = (id: string, version: number) => request.post(`/prompts/${id}/rollback/${version}`);
export const getPromptVersions = (id: string) => request.get(`/prompts/${id}/versions`);
