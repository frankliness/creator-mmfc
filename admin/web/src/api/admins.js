import request from "./request";
export const getAdmins = () => request.get("/admins");
export const createAdmin = (data) => request.post("/admins", data);
export const updateAdmin = (id, data) => request.patch(`/admins/${id}`, data);
