/**
 * v2.0.0：BytePlus Asset Library 客户端封装。
 *
 * 业务范围：CreateAssetGroup / GetAssetGroup / ListAssetGroups / CreateAsset / GetAsset
 *
 * 鉴权方式：Volcengine / BytePlus 标准 V4 HMAC-SHA256 签名。
 * - Endpoint: https://open.byteplusapi.com/
 * - Service: ark
 * - Region:  ap-southeast-1（默认；可通过 BYTEPLUS_REGION 覆盖）
 * - Version: 2024-01-01
 *
 * Actions 全部是 POST + JSON body + query 里带 Action 和 Version 参数。
 *
 * 凭据三级回退：
 *   调用方传入 → GlobalConfig（byteplus_access_key / byteplus_secret_key）→ 环境变量
 *     BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY / BYTEPLUS_REGION / BYTEPLUS_ENDPOINT
 *
 * 协议验证：本实现已通过真实 BytePlus 账号的完整端到端 E2E 测试
 * （CreateAssetGroup → CreateAsset → GetAsset 直到 Status=Active）。
 */

import { createHash, createHmac } from "crypto";
import { getGlobalConfig } from "./global-config";

const DEFAULT_BASE_URL = "https://open.byteplusapi.com";
const DEFAULT_REGION = "ap-southeast-1";
const SERVICE = "ark";
const API_VERSION = "2024-01-01";

export interface ByteplusAuth {
  accessKey: string;
  secretKey: string;
  region: string;
  baseUrl: string;
  projectName: string;
}

export class ByteplusApiError extends Error {
  status: number;
  /** BytePlus 返回的 error code，如 "MissingParameter.URL" */
  code: string;
  /** BytePlus 返回的原始 ResponseMetadata.Error 对象 */
  body: unknown;
  constructor(message: string, status: number, code: string, body: unknown) {
    super(message);
    this.name = "ByteplusApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

let cachedAuth: ByteplusAuth | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function resolveAuth(override?: Partial<ByteplusAuth>): Promise<ByteplusAuth> {
  if (cachedAuth && Date.now() - cachedAt < CACHE_TTL_MS && !override) return cachedAuth;

  const accessKey = override?.accessKey
    || await getGlobalConfig("byteplus_access_key")
    || process.env.BYTEPLUS_ACCESS_KEY;
  const secretKey = override?.secretKey
    || await getGlobalConfig("byteplus_secret_key")
    || process.env.BYTEPLUS_SECRET_KEY;
  const region = override?.region
    || await getGlobalConfig("byteplus_region")
    || process.env.BYTEPLUS_REGION
    || DEFAULT_REGION;
  const baseUrl = override?.baseUrl
    || await getGlobalConfig("byteplus_endpoint")
    || process.env.BYTEPLUS_ENDPOINT
    || DEFAULT_BASE_URL;
  const projectName = override?.projectName
    || await getGlobalConfig("byteplus_project_name")
    || process.env.BYTEPLUS_PROJECT_NAME
    || "default";

  if (!accessKey || !secretKey) {
    throw new Error("[byteplus-asset] BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY 未配置");
  }

  cachedAuth = {
    accessKey,
    secretKey,
    region,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    projectName,
  };
  cachedAt = Date.now();
  return cachedAuth;
}

export function resetByteplusAuthCache(): void {
  cachedAuth = null;
  cachedAt = 0;
}

// ──────────────────────────────────────────────
// V4 签名工具
// ──────────────────────────────────────────────

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key: Buffer | string, message: string): Buffer {
  return createHmac("sha256", key).update(message).digest();
}

function deriveSigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(secretKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signV4(input: {
  auth: ByteplusAuth;
  method: "GET" | "POST";
  query: Record<string, string>;
  body: string;
}): SignedRequest {
  const host = new URL(input.auth.baseUrl).host;
  const xDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const date = xDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);

  const sortedQs = Object.keys(input.query).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(input.query[k])}`)
    .join("&");

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${xDate}\n`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";

  const canonicalRequest = [
    input.method,
    "/",
    sortedQs,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${date}/${input.auth.region}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(input.auth.secretKey, date, input.auth.region, SERVICE);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization =
    `HMAC-SHA256 Credential=${input.auth.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${input.auth.baseUrl}/?${sortedQs}`,
    headers: {
      "Content-Type": "application/json",
      Host: host,
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
  };
}

// ──────────────────────────────────────────────
// 通用 request
// ──────────────────────────────────────────────

interface ByteplusResponse<T> {
  ResponseMetadata: {
    RequestId: string;
    Action: string;
    Version: string;
    Service: string;
    Region: string;
    Error?: {
      Code: string;
      Message: string;
      CodeN?: number;
      Data?: unknown;
    };
  };
  Result?: T;
}

async function call<T>(
  action: string,
  body: Record<string, unknown>,
  override?: Partial<ByteplusAuth>,
): Promise<T> {
  const auth = await resolveAuth(override);
  const bodyStr = JSON.stringify(body);
  const { url, headers } = signV4({
    auth,
    method: "POST",
    query: { Action: action, Version: API_VERSION },
    body: bodyStr,
  });

  const res = await fetch(url, { method: "POST", headers, body: bodyStr });
  const text = await res.text();
  let parsed: ByteplusResponse<T>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ByteplusApiError(
      `BytePlus ${action} 响应非 JSON: ${text.slice(0, 200)}`,
      res.status,
      "InvalidResponse",
      text,
    );
  }

  if (!res.ok || parsed.ResponseMetadata?.Error) {
    const err = parsed.ResponseMetadata?.Error;
    const code = err?.Code ?? "UnknownError";
    const message = err?.Message ?? `HTTP ${res.status}`;
    console.error(`[byteplus-asset] ${action} 失败: ${code} - ${message}`);
    throw new ByteplusApiError(`BytePlus ${action} 失败: ${message}`, res.status, code, parsed.ResponseMetadata);
  }

  if (parsed.Result === undefined) {
    throw new ByteplusApiError(`BytePlus ${action} 响应缺少 Result`, 200, "MissingResult", parsed);
  }
  return parsed.Result;
}

// ──────────────────────────────────────────────
// Asset Group
// ──────────────────────────────────────────────

export type AssetGroupType = "AIGC" | "Custom";

export interface CreateAssetGroupInput {
  /** Series 业务名，作为 BytePlus GroupName（最大 64 字符；命名校验由调用方完成） */
  groupName: string;
  description?: string;
  groupType?: AssetGroupType;
  projectName?: string;
}

export interface CreateAssetGroupResult {
  groupId: string;
  groupName: string;
  groupType: AssetGroupType;
  projectName: string;
  raw: unknown;
}

interface RawCreateAssetGroupResult {
  Id: string;
}

export async function createAssetGroup(
  input: CreateAssetGroupInput,
  override?: Partial<ByteplusAuth>,
): Promise<CreateAssetGroupResult> {
  const auth = await resolveAuth(override);
  const result = await call<RawCreateAssetGroupResult>("CreateAssetGroup", {
    Name: input.groupName,
    Description: input.description ?? undefined,
    GroupType: input.groupType ?? "AIGC",
    ProjectName: input.projectName ?? auth.projectName,
  }, override);
  return {
    groupId: result.Id,
    groupName: input.groupName,
    groupType: input.groupType ?? "AIGC",
    projectName: input.projectName ?? auth.projectName,
    raw: result,
  };
}

export interface AssetGroupSummary {
  groupId: string;
  groupName: string;
  groupType: string;
  projectName: string;
  description?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ListAssetGroupsInput {
  /** 模糊匹配 Group Name */
  keyword?: string;
  /** Filter 内的 GroupType，默认 "AIGC" */
  groupType?: AssetGroupType;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ListAssetGroupsResult {
  items: AssetGroupSummary[];
  totalCount: number;
  nextPageToken?: string;
  raw: unknown;
}

interface RawGroupItem {
  Id: string;
  Name: string;
  GroupType: string;
  ProjectName: string;
  Description?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

interface RawListAssetGroupsResult {
  TotalCount: number;
  Items: RawGroupItem[];
  NextPageToken?: string;
}

export async function listAssetGroups(
  input?: ListAssetGroupsInput,
  override?: Partial<ByteplusAuth>,
): Promise<ListAssetGroupsResult> {
  const auth = await resolveAuth(override);
  const body: Record<string, unknown> = {
    Filter: { GroupType: input?.groupType ?? "AIGC" },
    ProjectName: input?.projectName ?? auth.projectName,
  };
  if (input?.keyword) (body.Filter as Record<string, unknown>).Name = input.keyword;
  if (input?.pageSize) body.PageSize = input.pageSize;
  if (input?.pageToken) body.PageToken = input.pageToken;

  const result = await call<RawListAssetGroupsResult>("ListAssetGroups", body, override);
  return {
    items: (result.Items ?? []).map((g) => ({
      groupId: g.Id,
      groupName: g.Name,
      groupType: g.GroupType,
      projectName: g.ProjectName,
      description: g.Description,
      createTime: g.CreateTime,
      updateTime: g.UpdateTime,
    })),
    totalCount: result.TotalCount ?? 0,
    nextPageToken: result.NextPageToken,
    raw: result,
  };
}

export async function getAssetGroup(
  groupId: string,
  override?: Partial<ByteplusAuth>,
): Promise<AssetGroupSummary & { raw: unknown }> {
  const result = await call<RawGroupItem>("GetAssetGroup", { Id: groupId }, override);
  return {
    groupId: result.Id,
    groupName: result.Name,
    groupType: result.GroupType,
    projectName: result.ProjectName,
    description: result.Description,
    createTime: result.CreateTime,
    updateTime: result.UpdateTime,
    raw: result,
  };
}

// ──────────────────────────────────────────────
// Asset
// ──────────────────────────────────────────────

export type ByteplusAssetType = "Image" | "Video" | "Audio";
export type ByteplusAssetStatus = "Processing" | "Active" | "Failed";

export interface CreateAssetInput {
  groupId: string;
  /** 资产名（最大 64 字符；BytePlus 用于模糊搜索） */
  assetName: string;
  /**
   * 资产源 URL。**必须可被 BytePlus 服务器拉取**：
   * - bucket 公读时直接传 OSS 公网 URL
   * - bucket 私读时传 OSS 预签名 URL（TTL ≥ 1h，BytePlus 异步处理可能需要时间）
   */
  url: string;
  assetType: ByteplusAssetType;
  description?: string;
  projectName?: string;
}

export interface CreateAssetResult {
  assetId: string;
  /** 创建时刻已知的状态，通常是 Processing */
  status: ByteplusAssetStatus;
  raw: unknown;
}

interface RawCreateAssetResult {
  Id: string;
  Status?: string;
}

export async function createAsset(
  input: CreateAssetInput,
  override?: Partial<ByteplusAuth>,
): Promise<CreateAssetResult> {
  const auth = await resolveAuth(override);
  const result = await call<RawCreateAssetResult>("CreateAsset", {
    GroupId: input.groupId,
    Name: input.assetName,
    URL: input.url,
    AssetType: input.assetType,
    Description: input.description,
    ProjectName: input.projectName ?? auth.projectName,
  }, override);
  return {
    assetId: result.Id,
    status: normalizeAssetStatus(result.Status ?? "Processing"),
    raw: result,
  };
}

export interface GetAssetResult {
  assetId: string;
  status: ByteplusAssetStatus;
  errorMessage?: string;
  /** BytePlus 转存到 TOS 后的永久访问 URL（在 Seedance 提交时不需要，直接用 asset:// 即可） */
  byteplusUrl?: string;
  raw: unknown;
}

interface RawGetAssetResult {
  Id: string;
  Name?: string;
  URL?: string;
  AssetType?: string;
  GroupId?: string;
  Status: string;
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
  ErrorMessage?: string;
}

export async function getAsset(
  assetId: string,
  override?: Partial<ByteplusAuth>,
): Promise<GetAssetResult> {
  const result = await call<RawGetAssetResult>("GetAsset", { Id: assetId }, override);
  return {
    assetId: result.Id,
    status: normalizeAssetStatus(result.Status),
    errorMessage: result.ErrorMessage,
    byteplusUrl: result.URL,
    raw: result,
  };
}

function normalizeAssetStatus(raw: string): ByteplusAssetStatus {
  const s = (raw || "").toLowerCase();
  if (s === "active" || s === "succeeded" || s === "ready") return "Active";
  if (s === "failed" || s === "error") return "Failed";
  return "Processing";
}
