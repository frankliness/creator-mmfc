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
