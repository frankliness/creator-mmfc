import request from "./request";

export interface SeriesListParams {
  page?: number;
  size?: number;
  ownerId?: string;
  status?: string;
  search?: string;
}

export interface BudgetItem {
  provider: string;
  modelKey: string;
  budgetScope: string;
  metricType: "TOKEN" | "SUCCESS_COUNT";
  totalBudget: string | number;
  buffer?: string | number;
  isHardCap?: boolean;
  allocationMode?: "BUFFER_THEN_AVERAGE" | "AVERAGE" | "NONE";
}

export interface MemberItem {
  userId: string;
  role: "OWNER" | "PRODUCER" | "VIEWER";
}

/** v2.0.0：创建 Series 时可选地配置 BytePlus Asset Group */
export interface AssetGroupInput {
  /** bind=使用已有 BytePlus Group；create=调 BytePlus 创建新 Group */
  mode: "bind" | "create";
  /** mode=bind 必填 */
  groupId?: string;
  /** mode=create 必填，最大 64 字符 */
  groupName?: string;
  description?: string;
  projectName?: string;
}

export interface CreateSeriesPayload {
  name: string;
  description?: string | null;
  ownerId?: string | null;
  totalEpisodes: number;
  defaultRatio?: string;
  defaultResolution?: string;
  defaultStyle?: string;
  members: MemberItem[];
  resourceBudgets: BudgetItem[];
  /** v2.0.0：Asset Group 配置（可选） */
  assetGroup?: AssetGroupInput;
}

export interface SeriesAssetGroup {
  id: string;
  seriesId: string;
  provider: string;
  groupId: string | null;
  groupName: string;
  groupType: string;
  projectName: string;
  /** ACTIVE / FAILED / UNBOUND */
  status: string;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ByteplusAssetGroupSummary {
  groupId: string;
  groupName: string;
  groupType: string;
  projectName: string;
  createdAt?: string;
}

export const listSeries = (params?: SeriesListParams) =>
  request.get("/series", { params });

export const getSeries = (id: string) => request.get(`/series/${id}`);

export const createSeries = (payload: CreateSeriesPayload) =>
  request.post("/series", payload);

export const updateSeries = (id: string, data: {
  name?: string;
  description?: string | null;
  ownerId?: string | null;
  status?: "ACTIVE" | "LOCKED" | "ARCHIVED";
}) => request.patch(`/series/${id}`, data);

export const addSeriesMember = (id: string, data: MemberItem) =>
  request.post(`/series/${id}/members`, data);

export const updateSeriesMember = (id: string, memberId: string, data: {
  role?: "OWNER" | "PRODUCER" | "VIEWER";
  status?: "ACTIVE" | "REMOVED";
}) => request.patch(`/series/${id}/members/${memberId}`, data);

export const removeSeriesMember = (id: string, memberId: string) =>
  request.delete(`/series/${id}/members/${memberId}`);

export const listResourceBudgets = (id: string) =>
  request.get(`/series/${id}/resource-budgets`);

export const createResourceBudget = (id: string, data: BudgetItem) =>
  request.post(`/series/${id}/resource-budgets`, data);

export const updateResourceBudget = (id: string, budgetId: string, data: {
  totalBudget?: string | number;
  unallocatedBudget?: string | number;
  status?: string;
  isHardCap?: boolean;
}) => request.patch(`/series/${id}/resource-budgets/${budgetId}`, data);

export const adjustResourceBudget = (id: string, budgetId: string, data: {
  delta: string | number;
  reason?: string;
}) => request.post(`/series/${id}/resource-budgets/${budgetId}/adjust`, data);

export const listBudgetEvents = (id: string, params?: { page?: number; size?: number }) =>
  request.get(`/series/${id}/budget-events`, { params });

export const listUsageLogs = (id: string, params?: {
  page?: number;
  size?: number;
  budgetScope?: string;
  metricType?: string;
  status?: string;
}) => request.get(`/series/${id}/usage-logs`, { params });

export function assignProjectToSeries(seriesId: string, data: {
  projectId: string;
  episodeNumber?: number;
  episodeTitle?: string;
  allocatedTokens?: string;
}) {
  return request.post(`/series/${seriesId}/episodes/assign`, data);
}

export function distributeSeriesBudget(seriesId: string, budgetId: string) {
  return request.post(`/series/${seriesId}/resource-budgets/${budgetId}/distribute`);
}

// === v2.0.0: Asset Group ===

export const getSeriesAssetGroup = (id: string) =>
  request.get<SeriesAssetGroup | null>(`/series/${id}/asset-group`);

/** 创建 / 重试 / 改绑（同一接口，upsert 语义）。 */
export const bindSeriesAssetGroup = (id: string, payload: AssetGroupInput) =>
  request.post<SeriesAssetGroup>(`/series/${id}/asset-group`, payload);

export const unbindSeriesAssetGroup = (id: string) =>
  request.delete(`/series/${id}/asset-group`);

export const listByteplusAssetGroups = (params?: {
  keyword?: string;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
}) =>
  request.get<{ items: ByteplusAssetGroupSummary[]; nextPageToken?: string }>(
    "/series/byteplus/asset-groups",
    { params },
  );
