/**
 * v2.0.0：BytePlus Asset Library 客户端封装。
 *
 * 业务范围：
 *  - CreateAssetGroup / ListAssetGroups（Admin 创建 Series 时使用）
 *  - CreateAsset / GetAsset（用户端上传 + Worker 持久化后调用）
 *
 * 鉴权方式：复用 Seedance 同一 Bearer Token（BytePlus ARK 平台账号），
 * 凭据三级回退：调用方 → GlobalConfig（byteplus_api_key / byteplus_endpoint）→ 环境变量。
 *
 * ⚠️ 实现期 flag（PRD 第 11 条 + plan 风险点）：
 *  本文件中的具体 URL 路径（ENDPOINT_*）与请求体字段名是基于 BytePlus ARK 通用 API 模式的
 *  最佳推测。P0-B 阶段需在 Admin 后台用真实凭据跑一次 createAssetGroup，确认：
 *    1. 实际 API path（是 /contents/assets/groups 还是 /asset_library/groups）
 *    2. 请求体字段名（group_name vs name；asset_type vs type）
 *    3. 响应字段名（group_id / id / data.group_id）
 *  确认后修正本文件中标记的 // TODO(byteplus-verify) 处即可。
 */

import { getGlobalConfig } from "./global-config";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

// TODO(byteplus-verify): 在 P0-B 集成测试时确认实际路径
const ENDPOINT_CREATE_GROUP = "/contents/assets/groups";
const ENDPOINT_LIST_GROUPS = "/contents/assets/groups";
const ENDPOINT_CREATE_ASSET = "/contents/assets";
const ENDPOINT_GET_ASSET = (assetId: string) => `/contents/assets/${assetId}`;

export interface ByteplusAuth {
  apiKey: string;
  baseUrl: string;
  projectName: string;
}

export class ByteplusApiError extends Error {
  status: number;
  /** BytePlus 返回的原始错误体（解析后 JSON 或 raw text） */
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

async function resolveAuth(override?: Partial<ByteplusAuth>): Promise<ByteplusAuth> {
  if (cachedAuth && Date.now() - cachedAt < CACHE_TTL_MS && !override) return cachedAuth;

  // BytePlus Asset Library 与 Seedance 共用同一账号 API key
  const apiKey = override?.apiKey
    || await getGlobalConfig("byteplus_api_key")
    || await getGlobalConfig("seedance_api_key")
    || process.env.BYTEPLUS_API_KEY
    || process.env.SEEDANCE_API_KEY;
  const baseUrl = override?.baseUrl
    || await getGlobalConfig("byteplus_endpoint")
    || process.env.BYTEPLUS_ENDPOINT
    || DEFAULT_BASE_URL;
  const projectName = override?.projectName
    || await getGlobalConfig("byteplus_project_name")
    || process.env.BYTEPLUS_PROJECT_NAME
    || "default";

  if (!apiKey) {
    throw new Error("[byteplus-asset] BYTEPLUS_API_KEY 未配置（亦未在 GlobalConfig 中找到 byteplus_api_key/seedance_api_key）");
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
  method: "GET" | "POST" | "DELETE",
  path: string,
  options?: { query?: Record<string, string | number | undefined>; body?: unknown; override?: Partial<ByteplusAuth> },
): Promise<T> {
  const auth = await resolveAuth(options?.override);
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
    console.error(`[byteplus-asset] ${method} ${path} failed:`, res.status, text.slice(0, 500));
    throw new ByteplusApiError(
      `BytePlus ${method} ${path} 失败 (${res.status})`,
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

// ──────────────────────────────────────────────
// Asset Group
// ──────────────────────────────────────────────

export type AssetGroupType = "AIGC" | "Custom";

export interface CreateAssetGroupInput {
  /** Series 业务名，作为 BytePlus GroupName（最大 64 字符，命名校验由调用方完成） */
  groupName: string;
  description?: string;
  groupType?: AssetGroupType;
  projectName?: string;
}

export interface CreateAssetGroupResult {
  /** BytePlus 返回的 groupId */
  groupId: string;
  groupName: string;
  groupType: AssetGroupType;
  projectName: string;
  raw: unknown;
}

export async function createAssetGroup(
  input: CreateAssetGroupInput,
  override?: Partial<ByteplusAuth>,
): Promise<CreateAssetGroupResult> {
  const auth = await resolveAuth(override);
  // TODO(byteplus-verify): 字段名按 BytePlus ARK Asset Library 文档确认
  const body = {
    group_name: input.groupName,
    description: input.description,
    group_type: input.groupType ?? "AIGC",
    project_name: input.projectName ?? auth.projectName,
  };
  const data = await request<{ id?: string; group_id?: string; data?: { id?: string; group_id?: string } }>(
    "POST",
    ENDPOINT_CREATE_GROUP,
    { body, override },
  );
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

export interface ListAssetGroupsInput {
  keyword?: string;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
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

export async function listAssetGroups(
  input?: ListAssetGroupsInput,
  override?: Partial<ByteplusAuth>,
): Promise<ListAssetGroupsResult> {
  const auth = await resolveAuth(override);
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
    override,
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

// ──────────────────────────────────────────────
// Asset
// ──────────────────────────────────────────────

export type ByteplusAssetType = "Image" | "Video" | "Audio";
export type ByteplusAssetStatus = "Processing" | "Active" | "Failed";

export interface CreateAssetInput {
  groupId: string;
  /** BytePlus AssetName（最大 64 字符，命名校验由调用方完成） */
  assetName: string;
  /** OSS 公网 URL（必须可被 BytePlus 异步访问，BytePlus 通常需要至少 1h TTL） */
  url: string;
  assetType: ByteplusAssetType;
  /** 可选业务标签 */
  description?: string;
  projectName?: string;
}

export interface CreateAssetResult {
  assetId: string;
  status: ByteplusAssetStatus;
  raw: unknown;
}

export async function createAsset(
  input: CreateAssetInput,
  override?: Partial<ByteplusAuth>,
): Promise<CreateAssetResult> {
  const auth = await resolveAuth(override);
  // TODO(byteplus-verify): 字段名按 BytePlus ARK Asset Library 文档确认
  const body = {
    group_id: input.groupId,
    asset_name: input.assetName,
    url: input.url,
    asset_type: input.assetType,
    description: input.description,
    project_name: input.projectName ?? auth.projectName,
  };
  const data = await request<{
    id?: string;
    asset_id?: string;
    status?: string;
    data?: { id?: string; asset_id?: string; status?: string };
  }>("POST", ENDPOINT_CREATE_ASSET, { body, override });
  const assetId = data?.data?.asset_id ?? data?.data?.id ?? data?.asset_id ?? data?.id;
  const rawStatus = data?.data?.status ?? data?.status ?? "Processing";
  if (!assetId) {
    throw new ByteplusApiError("BytePlus createAsset 响应缺少 assetId", 200, data);
  }
  return {
    assetId,
    status: normalizeAssetStatus(rawStatus),
    raw: data,
  };
}

export interface GetAssetResult {
  assetId: string;
  status: ByteplusAssetStatus;
  /** Failed 时的错误描述 */
  errorMessage?: string;
  raw: unknown;
}

export async function getAsset(
  assetId: string,
  override?: Partial<ByteplusAuth>,
): Promise<GetAssetResult> {
  const data = await request<{
    id?: string;
    asset_id?: string;
    status?: string;
    error_message?: string;
    data?: { id?: string; asset_id?: string; status?: string; error_message?: string };
  }>("GET", ENDPOINT_GET_ASSET(assetId), { override });
  const rawStatus = data?.data?.status ?? data?.status ?? "Processing";
  const errorMessage = data?.data?.error_message ?? data?.error_message;
  return {
    assetId,
    status: normalizeAssetStatus(rawStatus),
    errorMessage,
    raw: data,
  };
}

function normalizeAssetStatus(raw: string): ByteplusAssetStatus {
  const s = raw.toLowerCase();
  if (s.includes("active") || s === "succeeded" || s === "ready") return "Active";
  if (s.includes("fail") || s === "error") return "Failed";
  return "Processing";
}
