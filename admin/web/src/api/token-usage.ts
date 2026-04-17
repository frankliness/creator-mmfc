import request from "./request";

export const getSummary = (params?: Record<string, unknown>) =>
  request.get("/token-usage/summary", { params });

export const getByUser = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-user", { params });

export const getByProvider = (params?: Record<string, unknown>) =>
  request.get("/token-usage/by-provider", { params });

export const getDetail = (params?: Record<string, unknown>) =>
  request.get("/token-usage/detail", { params });
