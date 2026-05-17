import request from "./request";

export const getSummary = (params?: Record<string, unknown>) =>
  request.get("/token-usage/summary", { params });

export const getByUser = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-user", { params });

export const getByProvider = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-provider", { params });

export const getDetail = (params?: Record<string, unknown>) =>
  request.get("/token-usage/detail", { params });

export const exportTokenUsage = (params?: Record<string, unknown>) =>
  request.get<Blob>("/token-usage/export", { params, responseType: "blob" });

export const exportTokenUsageByUser = (params?: Record<string, unknown>) =>
  request.get<Blob>("/token-usage/export/by-user", { params, responseType: "blob" });

/** 以 Project 为维度 */
export const getByProject = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-project", { params });

/** 以 Series 为维度 */
export const getBySeries = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-series", { params });

/** 以 Series 为维度的明细（集数 × 用户） */
export const getBySeriesBreakdown = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-series-breakdown", { params });

/** AI 画布：CanvasAiCall 聚合 */
export const getCanvasByUser = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-user", { params });

export const getCanvasByProject = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-project", { params });

export const getCanvasByModel = (params?: Record<string, unknown>) =>
  request.get("/token-usage/canvas/by-model", { params });
