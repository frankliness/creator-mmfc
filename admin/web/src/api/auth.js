import request from "./request";
export const login = (data) => request.post("/auth/login", data);
export const refreshToken = (refreshToken) => request.post("/auth/refresh", { refreshToken });
export const getProfile = () => request.get("/auth/profile");
export const changePassword = (data) => request.patch("/auth/password", data);
