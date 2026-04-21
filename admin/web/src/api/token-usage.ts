import request from "./request";

export const getSummary = (params?: Record<string, unknown>) =>
  request.get("/token-usage/summary", { params });

export const getByUser = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-user", { params });

export const getByProvider = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-provider", { params });

export const getDetail = (params?: Record<string, unknown>) =>
  request.get("/token-usage/detail", { params });

/** AI 画布：CanvasAiCall 聚合 */
export const getCanvasByUser = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-user", { params });

export const getCanvasByProject = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-project", { params });

export const getCanvasByModel = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-model", { params });
