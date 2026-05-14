import request from "./request";
/** 拉取最近 windowMin 分钟（默认 60）各渠道的画布生图统计 */
export const listChannelStats = (windowMin = 60) => request.get("/canvas-channel-stats", { params: { windowMin } });
