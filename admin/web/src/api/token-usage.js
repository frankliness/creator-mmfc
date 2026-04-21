import request from "./request";
export const getSummary = (params) => request.get("/token-usage/summary", { params });
export const getByUser = (params) => request.get("/token-usage/by-user", { params });
export const getByProvider = (params) => request.get("/token-usage/by-provider", { params });
export const getDetail = (params) => request.get("/token-usage/detail", { params });
/** AI 画布：CanvasAiCall 聚合 */
export const getCanvasByUser = (params) => request.get("/token-usage/canvas/by-user", { params });
export const getCanvasByProject = (params) => request.get("/token-usage/canvas/by-project", { params });
export const getCanvasByModel = (params) => request.get("/token-usage/canvas/by-model", { params });
