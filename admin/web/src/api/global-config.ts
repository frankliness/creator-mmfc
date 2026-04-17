import request from "./request";

export const getGlobalConfigs = () => request.get("/global-configs");

export const updateGlobalConfig = (key: string, data: Record<string, unknown>) =>
  request.patch(`/global-configs/${key}`, data);
