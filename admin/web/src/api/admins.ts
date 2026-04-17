import request from "./request";

export const getAdmins = () => request.get("/admins");

export const createAdmin = (data: Record<string, unknown>) =>
  request.post("/admins", data);

export const updateAdmin = (id: string, data: Record<string, unknown>) =>
  request.patch(`/admins/${id}`, data);
