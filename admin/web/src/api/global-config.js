import request from "./request";
export const getGlobalConfigs = () => request.get("/global-configs");
export const updateGlobalConfig = (key, data) => request.patch(`/global-configs/${key}`, data);
