import request from "./request";

export interface ChannelStat {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  concurrency: number;
  cooldownUntil: string | null;
  inCooldown: boolean;
  currentRunning: number;
  success: number;
  failed: number;
  rateLimited: number;
}

/** 拉取最近 windowMin 分钟（默认 60）各渠道的画布生图统计 */
export const listChannelStats = (windowMin = 60): Promise<ChannelStat[]> =>
  request.get("/canvas-channel-stats", { params: { windowMin } });
