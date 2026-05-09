import request from "./request";

export type ModelCategory = "chat" | "canvas_image" | "canvas_image_edit" | "storyboard";

export interface ModelEntry {
  id: string;
  modelKey: string;
  label: string;
  category: ModelCategory;
  providers: string[];
  capabilities: Record<string, boolean | unknown>;
  sizes?: string[] | null;
  qualities?: Array<{ label: string; key: string }> | null;
  defaultParams?: Record<string, string> | null;
  tips?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const listModels = (category?: ModelCategory): Promise<ModelEntry[]> =>
  request.get("/model-registry", { params: category ? { category } : {} });

export const createModel = (data: Partial<ModelEntry>) =>
  request.post("/model-registry", data);

export const updateModel = (id: string, data: Partial<ModelEntry>) =>
  request.patch(`/model-registry/${id}`, data);

export const toggleModel = (id: string) =>
  request.patch(`/model-registry/${id}/toggle`);

export const deleteModel = (id: string) =>
  request.delete(`/model-registry/${id}`);
