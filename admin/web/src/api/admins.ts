import request from "./request";

export const getAdmins = (params?: { includeDeleted?: boolean }) =>
  request.get("/admins", { params });

export const createAdmin = (data: Record<string, unknown>) =>
  request.post("/admins", data);

export const updateAdmin = (id: string, data: Record<string, unknown>) =>
  request.patch(`/admins/${id}`, data);

export const deleteAdmin = (id: string) => request.delete(`/admins/${id}`);

export const resetAdminPassword = (id: string, newPassword: string) =>
  request.post(`/admins/${id}/reset-password`, { newPassword });
