import request from "./request";
export const listCredentials = (provider) => request.get("/credentials", { params: provider ? { provider } : {} });
export const getCredential = (id) => request.get(`/credentials/${id}`);
export const createCredential = (data) => request.post("/credentials", data);
export const updateCredential = (id, data) => request.patch(`/credentials/${id}`, data);
export const toggleCredential = (id) => request.patch(`/credentials/${id}/toggle`);
export const setPrimaryCredential = (id) => request.patch(`/credentials/${id}/set-primary`);
export const deleteCredential = (id) => request.delete(`/credentials/${id}`);
export const testCredential = (id) => request.post(`/credentials/${id}/test`);
