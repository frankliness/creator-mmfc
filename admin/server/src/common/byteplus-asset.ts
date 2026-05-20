/**
 * v2.0.0：BytePlus Asset Library 客户端（Admin 端用）。
 *
 * 与 web/src/lib/byteplus-asset.ts 保持接口一致；两边凭据来自同一 BYTEPLUS_API_KEY。
 *
 * ⚠️ 实现期 flag：URL path 与字段名标记 TODO(byteplus-verify)，P0-B
 *    集成测试时与 web 端同步修正。
 */

import { prisma } from "./prisma.js";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

const ENDPOINT_CREATE_GROUP = "/contents/assets/groups";
const ENDPOINT_LIST_GROUPS = "/contents/assets/groups";

export interface ByteplusAuth {
  apiKey: string;
  baseUrl: string;
  projectName: string;
}

export class ByteplusApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ByteplusApiError";
    this.status = status;
    this.body = body;
  }
}

let cachedAuth: ByteplusAuth | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function readGlobalConfig(key: string): Promise<string | null> {
  try {
    const row = await prisma.globalConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function resolveAuth(): Promise<ByteplusAuth> {
  if (cachedAuth && Date.now() - cachedAt < CACHE_TTL_MS) return cachedAuth;

  const apiKey = (await readGlobalConfig("byteplus_api_key"))
    || (await readGlobalConfig("seedance_api_key"))
    || process.env.BYTEPLUS_API_KEY
    || process.env.SEEDANCE_API_KEY;
  const baseUrl = (await readGlobalConfig("byteplus_endpoint"))
    || process.env.BYTEPLUS_ENDPOINT
    || DEFAULT_BASE_URL;
  const projectName = (await readGlobalConfig("byteplus_project_name"))
    || process.env.BYTEPLUS_PROJECT_NAME
    || "default";

  if (!apiKey) {
    throw new Error("[byteplus-asset] BYTEPLUS_API_KEY 未配置");
  }
  cachedAuth = { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), projectName };
  cachedAt = Date.now();
  return cachedAuth;
}

export function resetByteplusAuthCache(): void {
  cachedAuth = null;
  cachedAt = 0;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  options?: { query?: Record<string, string | number | undefined>; body?: unknown },
): Promise<T> {
  const auth = await resolveAuth();
  const url = new URL(`${auth.baseUrl}${path}`);
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    throw new ByteplusApiError(
      `BytePlus ${method} ${path} 失败 (${res.status})`,
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

export type AssetGroupType = "AIGC" | "Custom";

export interface CreateAssetGroupResult {
  groupId: string;
  groupName: string;
  groupType: AssetGroupType;
  projectName: string;
  raw: unknown;
}

export async function createAssetGroup(input: {
  groupName: string;
  description?: string;
  groupType?: AssetGroupType;
  projectName?: string;
}): Promise<CreateAssetGroupResult> {
  const auth = await resolveAuth();
  const body = {
    group_name: input.groupName,
    description: input.description,
    group_type: input.groupType ?? "AIGC",
    project_name: input.projectName ?? auth.projectName,
  };
  const data = await request<{
    id?: string;
    group_id?: string;
    data?: { id?: string; group_id?: string };
  }>("POST", ENDPOINT_CREATE_GROUP, { body });
  const groupId = data?.data?.group_id ?? data?.data?.id ?? data?.group_id ?? data?.id;
  if (!groupId) {
    throw new ByteplusApiError("BytePlus createAssetGroup 响应缺少 groupId", 200, data);
  }
  return {
    groupId,
    groupName: input.groupName,
    groupType: input.groupType ?? "AIGC",
    projectName: input.projectName ?? auth.projectName,
    raw: data,
  };
}

export interface AssetGroupSummary {
  groupId: string;
  groupName: string;
  groupType: string;
  projectName: string;
  createdAt?: string;
}

export interface ListAssetGroupsResult {
  items: AssetGroupSummary[];
  nextPageToken?: string;
  raw: unknown;
}

export async function listAssetGroups(input?: {
  keyword?: string;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<ListAssetGroupsResult> {
  const auth = await resolveAuth();
  const data = await request<{
    data?: { items?: Array<Record<string, unknown>>; next_page_token?: string };
    items?: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>("GET", ENDPOINT_LIST_GROUPS, {
    query: {
      keyword: input?.keyword,
      project_name: input?.projectName ?? auth.projectName,
      page_size: input?.pageSize ?? 50,
      page_token: input?.pageToken,
    },
  });
  const rawItems = data?.data?.items ?? data?.items ?? [];
  const items: AssetGroupSummary[] = rawItems.map((it) => ({
    groupId: String(it.group_id ?? it.id ?? ""),
    groupName: String(it.group_name ?? it.name ?? ""),
    groupType: String(it.group_type ?? "AIGC"),
    projectName: String(it.project_name ?? auth.projectName),
    createdAt: typeof it.created_at === "string" ? it.created_at : undefined,
  }));
  return {
    items,
    nextPageToken: data?.data?.next_page_token ?? data?.next_page_token,
    raw: data,
  };
}
