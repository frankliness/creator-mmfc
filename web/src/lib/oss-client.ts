/**
 * v2.0.0：阿里云 OSS 客户端封装（Series 素材库长期存储）。
 *
 * 凭证三级回退：调用方传入 → GlobalConfig 表 → 环境变量（与 seedance.ts 一致）。
 * - aliyun_oss_region / aliyun_oss_bucket / aliyun_oss_access_key_id / aliyun_oss_access_key_secret
 *   / aliyun_oss_endpoint / aliyun_oss_public_host
 *
 * OSS bucket 需开启公网读，或在 PRD 第二阶段切换为预签名 URL（BytePlus CreateAsset 时使用）。
 */

import OSS from "ali-oss";
import { getGlobalConfig } from "./global-config";

export interface OssConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 可选自定义 endpoint。不设置则由 SDK 基于 region 推导 */
  endpoint?: string;
  /** 可选公网域名（不带 protocol），例如 my-bucket.oss-cn-shanghai.aliyuncs.com 或自定义 CDN */
  publicHost?: string;
}

let cachedConfig: OssConfig | null = null;
let cachedAt = 0;
const CONFIG_TTL_MS = 60_000;

/**
 * 加载 OSS 配置。三级回退：传入 → GlobalConfig → 环境变量。
 * 缓存 60s。
 */
export async function loadOssConfig(override?: Partial<OssConfig>): Promise<OssConfig> {
  if (cachedConfig && Date.now() - cachedAt < CONFIG_TTL_MS && !override) {
    return cachedConfig;
  }

  const region = override?.region
    || await getGlobalConfig("aliyun_oss_region")
    || process.env.ALIYUN_OSS_REGION;
  const bucket = override?.bucket
    || await getGlobalConfig("aliyun_oss_bucket")
    || process.env.ALIYUN_OSS_BUCKET;
  const accessKeyId = override?.accessKeyId
    || await getGlobalConfig("aliyun_oss_access_key_id")
    || process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = override?.accessKeySecret
    || await getGlobalConfig("aliyun_oss_access_key_secret")
    || process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  const endpoint = override?.endpoint
    || await getGlobalConfig("aliyun_oss_endpoint")
    || process.env.ALIYUN_OSS_ENDPOINT
    || undefined;
  const publicHost = override?.publicHost
    || await getGlobalConfig("aliyun_oss_public_host")
    || process.env.ALIYUN_OSS_PUBLIC_HOST
    || undefined;

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error(
      "[oss-client] 阿里云 OSS 配置缺失（需要 region/bucket/accessKeyId/accessKeySecret）"
    );
  }

  const config: OssConfig = {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
    publicHost,
  };
  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}

/**
 * 重置缓存（GlobalConfig 更新后调用）。
 */
export function resetOssConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

async function getClient(override?: Partial<OssConfig>): Promise<{ client: OSS; config: OssConfig }> {
  const config = await loadOssConfig(override);
  const client = new OSS({
    region: config.region,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    endpoint: config.endpoint,
    secure: true,
  });
  return { client, config };
}

/**
 * 构造资产公网 URL。优先使用 publicHost；否则使用 ali-oss SDK 返回的 url。
 * 注意：返回的 URL 是 https，永久有效（前提是 bucket 公读 ACL）。
 */
export function buildPublicUrl(config: OssConfig, objectKey: string): string {
  if (config.publicHost) {
    const host = config.publicHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}/${encodeURI(objectKey)}`;
  }
  const host = config.endpoint
    ? config.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${config.region}.aliyuncs.com`;
  return `https://${config.bucket}.${host}/${encodeURI(objectKey)}`;
}

export interface UploadResult {
  bucket: string;
  objectKey: string;
  publicUrl: string;
  /** OSS 返回的 etag */
  etag?: string;
}

/**
 * 上传 Buffer 到 OSS。
 * @param objectKey 对象 key（必须 ASCII 安全，调用方先用 buildOssObjectKey 构造）
 * @param data 二进制数据
 * @param options.contentType mime type，默认 application/octet-stream
 */
export async function uploadBuffer(
  objectKey: string,
  data: Buffer | Uint8Array,
  options?: { contentType?: string; cacheControl?: string },
): Promise<UploadResult> {
  const { client, config } = await getClient();
  const headers: Record<string, string> = {};
  if (options?.contentType) headers["Content-Type"] = options.contentType;
  if (options?.cacheControl) headers["Cache-Control"] = options.cacheControl;
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  const result = await client.put(objectKey, buf, { headers });
  return {
    bucket: config.bucket,
    objectKey,
    publicUrl: buildPublicUrl(config, objectKey),
    etag: (result.res as { headers?: Record<string, string> })?.headers?.etag,
  };
}

/**
 * 上传可读流到 OSS。用于大文件（视频）避免全量加载到内存。
 */
export async function uploadStream(
  objectKey: string,
  stream: NodeJS.ReadableStream,
  options?: { contentType?: string; contentLength?: number; cacheControl?: string },
): Promise<UploadResult> {
  const { client, config } = await getClient();
  const headers: Record<string, string> = {};
  if (options?.contentType) headers["Content-Type"] = options.contentType;
  if (options?.cacheControl) headers["Cache-Control"] = options.cacheControl;
  // ali-oss 的 PutStreamOptions 在类型上要求 timeout/mime/meta/callback，但运行时全为 optional。
  // 用 as 跳过类型严格匹配 — 运行时 SDK 会 fallback 到默认值。
  await client.putStream(objectKey, stream, {
    headers,
    contentLength: options?.contentLength,
  } as Parameters<typeof client.putStream>[2]);
  return {
    bucket: config.bucket,
    objectKey,
    publicUrl: buildPublicUrl(config, objectKey),
  };
}

/**
 * 生成预签名 URL，TTL 单位秒。
 * 如果未来切换到私读 bucket，BytePlus CreateAsset 时改用此函数即可。
 */
export async function getSignedUrl(objectKey: string, expiresSec: number = 3600): Promise<string> {
  const { client } = await getClient();
  return client.signatureUrl(objectKey, { expires: expiresSec });
}

/**
 * 检查对象是否存在 + 返回元信息（size、mime、etag）。
 * 不存在时抛错或返回 null（按 ali-oss 行为，404 会 throw）。
 */
export async function headObject(objectKey: string): Promise<{
  exists: boolean;
  size?: number;
  contentType?: string;
  etag?: string;
}> {
  const { client } = await getClient();
  try {
    const result = await client.head(objectKey);
    const h = (result.res as { headers?: Record<string, string> })?.headers ?? {};
    return {
      exists: true,
      size: h["content-length"] ? Number(h["content-length"]) : undefined,
      contentType: h["content-type"],
      etag: h["etag"],
    };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return { exists: false };
    throw err;
  }
}
