/**
 * v2.0.0：BytePlus Asset Library 客户端（Admin 端）。
 *
 * 与 web/src/lib/byteplus-asset.ts 实现一致：V4 HMAC-SHA256 签名，
 * Endpoint=https://open.byteplusapi.com, Service=ark, Region=ap-southeast-1, Version=2024-01-01。
 *
 * 凭据：BYTEPLUS_ACCESS_KEY + BYTEPLUS_SECRET_KEY，GlobalConfig 表 fallback。
 *
 * 本实现已通过真实账号 E2E 验证。
 */

import { createHash, createHmac } from "crypto";
import { prisma } from "./prisma.js";

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
  code: string;
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

  const accessKey = (await readGlobalConfig("byteplus_access_key")) || process.env.BYTEPLUS_ACCESS_KEY;
  const secretKey = (await readGlobalConfig("byteplus_secret_key")) || process.env.BYTEPLUS_SECRET_KEY;
  const region = (await readGlobalConfig("byteplus_region")) || process.env.BYTEPLUS_REGION || DEFAULT_REGION;
  const baseUrl = (await readGlobalConfig("byteplus_endpoint")) || process.env.BYTEPLUS_ENDPOINT || DEFAULT_BASE_URL;
  const projectName = (await readGlobalConfig("byteplus_project_name")) || process.env.BYTEPLUS_PROJECT_NAME || "default";

  if (!accessKey || !secretKey) {
    throw new Error("[byteplus-asset] BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY 未配置");
  }

  cachedAuth = { accessKey, secretKey, region, baseUrl: baseUrl.replace(/\/+$/, ""), projectName };
  cachedAt = Date.now();
  return cachedAuth;
}

export function resetByteplusAuthCache(): void {
  cachedAuth = null;
  cachedAt = 0;
}

// ──────────────────────────────────────────────
// V4 签名
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

function signV4(input: {
  auth: ByteplusAuth;
  method: "POST";
  query: Record<string, string>;
  body: string;
}): { url: string; headers: Record<string, string> } {
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
  const canonicalRequest = [input.method, "/", sortedQs, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${date}/${input.auth.region}/${SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = deriveSigningKey(input.auth.secretKey, date, input.auth.region, SERVICE);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    url: `${input.auth.baseUrl}/?${sortedQs}`,
    headers: {
      "Content-Type": "application/json",
      Host: host,
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: `HMAC-SHA256 Credential=${input.auth.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
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
    Error?: { Code: string; Message: string; CodeN?: number; Data?: unknown };
  };
  Result?: T;
}

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const auth = await resolveAuth();
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
    throw new ByteplusApiError(`BytePlus ${action} 响应非 JSON: ${text.slice(0, 200)}`, res.status, "InvalidResponse", text);
  }
  if (!res.ok || parsed.ResponseMetadata?.Error) {
    const err = parsed.ResponseMetadata?.Error;
    const code = err?.Code ?? "UnknownError";
    const message = err?.Message ?? `HTTP ${res.status}`;
    throw new ByteplusApiError(`BytePlus ${action} 失败: ${message}`, res.status, code, parsed.ResponseMetadata);
  }
  if (parsed.Result === undefined) {
    throw new ByteplusApiError(`BytePlus ${action} 响应缺少 Result`, 200, "MissingResult", parsed);
  }
  return parsed.Result;
}

// ──────────────────────────────────────────────
// Asset Group API（Admin 只用到 Group 维度）
// ──────────────────────────────────────────────

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
  const result = await call<{ Id: string }>("CreateAssetGroup", {
    Name: input.groupName,
    Description: input.description ?? undefined,
    GroupType: input.groupType ?? "AIGC",
    ProjectName: input.projectName ?? auth.projectName,
  });
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

export async function listAssetGroups(input?: {
  keyword?: string;
  groupType?: AssetGroupType;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<ListAssetGroupsResult> {
  const auth = await resolveAuth();
  const body: Record<string, unknown> = {
    Filter: { GroupType: input?.groupType ?? "AIGC" },
    ProjectName: input?.projectName ?? auth.projectName,
  };
  if (input?.keyword) (body.Filter as Record<string, unknown>).Name = input.keyword;
  if (input?.pageSize) body.PageSize = input.pageSize;
  if (input?.pageToken) body.PageToken = input.pageToken;
  const result = await call<{ TotalCount: number; Items: RawGroupItem[]; NextPageToken?: string }>(
    "ListAssetGroups",
    body,
  );
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
