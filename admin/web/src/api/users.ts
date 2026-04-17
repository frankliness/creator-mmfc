import request from "./request";

export const getUsers = (params?: Record<string, unknown>) =>
  request.get("/users", { params });

export const getUser = (id: string) => request.get(`/users/${id}`);

export const updateUser = (id: string, data: Record<string, unknown>) =>
  request.patch(`/users/${id}`, data);

export const resetPassword = (id: string) =>
  request.post(`/users/${id}/reset-password`);

export const getUserApiConfigs = (userId: string) =>
  request.get(`/users/${userId}/api-configs`);

export const createApiConfig = (userId: string, data: Record<string, unknown>) =>
  request.post(`/users/${userId}/api-configs`, data);

export const updateApiConfig = (userId: string, configId: string, data: Record<string, unknown>) =>
  request.patch(`/users/${userId}/api-configs/${configId}`, data);

export const deleteApiConfig = (userId: string, configId: string) =>
  request.delete(`/users/${userId}/api-configs/${configId}`);

export const testApiConfig = (userId: string, configId: string) =>
  request.post(`/users/${userId}/api-configs/${configId}/test`);
