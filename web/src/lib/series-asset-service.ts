/**
 * v2.0.0：Series 素材库核心服务。
 *
 * 所有上层 API 路由（用户上传 / Canvas 同步 / Worker 视频持久化）通过这里写 SeriesAsset。
 * 职责：命名校验、唯一性判重、OSS 上传、SeriesAsset 写入、BytePlus 同步触发。
 *
 * BytePlus 同步遵循"立即返回 SYNCING，前端轮询"的异步模式 —— 本 service 的
 * createXxx 函数会 fire-and-forget 触发后台 BytePlus CreateAsset，不阻塞调用方。
 */

import { prisma } from "./prisma";
import {
  normalizeAssetName,
  validateAssetName,
  buildOssObjectKey,
  buildVideoAssetName,
  buildTailFrameAssetName,
  extFromMime,
  type AssetType,
} from "./asset-naming";
import { uploadBuffer } from "./oss-client";
import {
  createAsset as byteplusCreateAsset,
  getAsset as byteplusGetAsset,
  ByteplusApiError,
  type ByteplusAssetType,
} from "./byteplus-asset";
import type { ProbeResult } from "./asset-metadata-probe";
import { randomUUID as nodeRandomUUID } from "crypto";

const newAssetId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? nodeRandomUUID();

export class SeriesAssetError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AssetSource = "MANUAL_UPLOAD" | "CANVAS_GENERATED" | "VIDEO_RESULT" | "VIDEO_TAIL_FRAME";

function probeTypeToByteplus(t: AssetType): ByteplusAssetType {
  if (t === "VIDEO") return "Video";
  if (t === "AUDIO") return "Audio";
  return "Image";
}

/**
 * 用户手动上传：probe → OSS → SeriesAsset → 异步 BytePlus 同步。
 *
 * 已假定上层调用方完成了文件大小、mime 类型粗筛、用户登录态校验等。
 */
export async function createSeriesAssetFromUpload(input: {
  seriesId: string;
  userId: string;
  rawName: string;
  buffer: Buffer;
  probe: ProbeResult;
}) {
  // 命名校验
  const nameCheck = validateAssetName(input.rawName);
  if (!nameCheck.ok) {
    throw new SeriesAssetError(400, "INVALID_NAME", nameCheck.error!);
  }

  // 提前判重（不依赖 DB 唯一索引报错）
  const normalizedName = normalizeAssetName(input.rawName);
  const dup = await prisma.seriesAsset.findUnique({
    where: { seriesId_normalizedName: { seriesId: input.seriesId, normalizedName } },
    select: { id: true },
  });
  if (dup) {
    throw new SeriesAssetError(409, "DUPLICATE_NAME", `同名资产已存在: ${input.rawName}`);
  }

  const ext = extFromMime(input.probe.mimeType);
  // 预生成 UUID 既作为 SeriesAsset.id，又作为 OSS key — 一次原子写入
  const assetId = newAssetId();
  const objectKey = buildOssObjectKey({
    seriesId: input.seriesId,
    assetId,
    ext,
    kind: "upload",
  });

  const uploaded = await uploadBuffer(objectKey, input.buffer, { contentType: input.probe.mimeType });

  const asset = await prisma.seriesAsset.create({
    data: {
      id: assetId,
      seriesId: input.seriesId,
      name: input.rawName,
      normalizedName,
      type: input.probe.type,
      source: "MANUAL_UPLOAD",
      mimeType: input.probe.mimeType,
      bytes: input.probe.bytes,
      width: input.probe.width,
      height: input.probe.height,
      durationSec: input.probe.durationSec,
      fps: input.probe.fps,
      ossBucket: uploaded.bucket,
      ossObjectKey: uploaded.objectKey,
      ossPublicUrl: uploaded.publicUrl,
      byteplusAssetName: input.rawName,
      byteplusAssetType: probeTypeToByteplus(input.probe.type),
      byteplusSyncStatus: "NOT_SYNCED",
      createdBy: input.userId,
    },
  });

  // 触发 BytePlus 同步（非阻塞）
  const willSync = await maybeTriggerByteplusSync(asset.id, asset.seriesId);
  return { asset, willSync };
}

/**
 * 检查 Series 是否绑定有效 Group；若是则把资产标记为 SYNCING 并 fire-and-forget 触发 CreateAsset。
 * 返回值表示是否已触发同步。
 */
export async function maybeTriggerByteplusSync(assetId: string, seriesId: string): Promise<boolean> {
  const group = await prisma.seriesAssetGroup.findUnique({ where: { seriesId } });
  if (!group || group.status !== "ACTIVE" || !group.groupId) {
    return false;
  }
  await prisma.seriesAsset.update({
    where: { id: assetId },
    data: {
      byteplusGroupId: group.groupId,
      byteplusGroupName: group.groupName,
      byteplusSyncStatus: "SYNCING",
      byteplusSyncError: null,
    },
  });
  // fire-and-forget；错误已被内部捕获写回 FAILED
  void doByteplusCreateAsset(assetId).catch(() => undefined);
  return true;
}

async function doByteplusCreateAsset(assetId: string): Promise<void> {
  const asset = await prisma.seriesAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  if (!asset.byteplusGroupId || !asset.byteplusAssetType || !asset.byteplusAssetName) {
    await prisma.seriesAsset.update({
      where: { id: assetId },
      data: { byteplusSyncStatus: "FAILED", byteplusSyncError: "缺少 group/name/type 信息" },
    });
    return;
  }
  try {
    const result = await byteplusCreateAsset({
      groupId: asset.byteplusGroupId,
      assetName: asset.byteplusAssetName,
      url: asset.ossPublicUrl,
      assetType: asset.byteplusAssetType as ByteplusAssetType,
    });
    await prisma.seriesAsset.update({
      where: { id: assetId },
      data: {
        byteplusAssetId: result.assetId,
        byteplusSyncStatus: result.status === "Active" ? "SYNCED" :
                            result.status === "Failed" ? "FAILED" : "PROCESSING",
        byteplusSyncError: result.status === "Failed" ? "BytePlus 返回 Failed" : null,
        syncedAt: result.status === "Active" ? new Date() : null,
      },
    });
  } catch (err) {
    const msg = err instanceof ByteplusApiError
      ? `BytePlus 错误 (${err.status}): ${err.message}`
      : err instanceof Error ? err.message : "BytePlus 同步失败";
    await prisma.seriesAsset.update({
      where: { id: assetId },
      data: { byteplusSyncStatus: "FAILED", byteplusSyncError: msg },
    });
  }
}

/**
 * 刷新资产的 BytePlus 同步状态（前端轮询时调用）。
 * 命中 PROCESSING 时调 BytePlus GetAsset；命中 SYNCED/FAILED 直接返回。
 */
export async function refreshByteplusStatus(assetId: string): Promise<{
  status: string;
  error: string | null;
}> {
  const asset = await prisma.seriesAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new SeriesAssetError(404, "ASSET_NOT_FOUND", "资产不存在");

  if (!asset.byteplusAssetId) {
    return { status: asset.byteplusSyncStatus, error: asset.byteplusSyncError };
  }
  // 已到终态，无需再查
  if (asset.byteplusSyncStatus === "SYNCED" || asset.byteplusSyncStatus === "FAILED") {
    return { status: asset.byteplusSyncStatus, error: asset.byteplusSyncError };
  }

  try {
    const result = await byteplusGetAsset(asset.byteplusAssetId);
    const nextStatus = result.status === "Active" ? "SYNCED" :
                       result.status === "Failed" ? "FAILED" : "PROCESSING";
    const updated = await prisma.seriesAsset.update({
      where: { id: assetId },
      data: {
        byteplusSyncStatus: nextStatus,
        byteplusSyncError: result.status === "Failed" ? (result.errorMessage ?? "BytePlus 返回 Failed") : null,
        syncedAt: result.status === "Active" ? new Date() : asset.syncedAt,
      },
    });
    return { status: updated.byteplusSyncStatus, error: updated.byteplusSyncError };
  } catch (err) {
    const msg = err instanceof ByteplusApiError
      ? `BytePlus 错误 (${err.status}): ${err.message}`
      : err instanceof Error ? err.message : "查询 BytePlus 失败";
    // 网络错误不立即标 FAILED（可能临时不可达），保持原状态但更新 error
    await prisma.seriesAsset.update({
      where: { id: assetId },
      data: { byteplusSyncError: msg },
    });
    return { status: asset.byteplusSyncStatus, error: msg };
  }
}

/**
 * 手动重试同步（FAILED → SYNCING）。
 * 老资产没有 byteplusAssetId 的情况下，会走 CreateAsset 重新创建。
 */
export async function retrySyncByteplus(assetId: string): Promise<{ status: string }> {
  const asset = await prisma.seriesAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new SeriesAssetError(404, "ASSET_NOT_FOUND", "资产不存在");

  // 已 SYNCED 的不重试（避免重复创建 BytePlus 资产）
  if (asset.byteplusSyncStatus === "SYNCED") {
    return { status: "SYNCED" };
  }

  const group = await prisma.seriesAssetGroup.findUnique({ where: { seriesId: asset.seriesId } });
  if (!group || group.status !== "ACTIVE" || !group.groupId) {
    throw new SeriesAssetError(400, "GROUP_NOT_ACTIVE", "Series 未绑定有效的 Asset Group");
  }

  await prisma.seriesAsset.update({
    where: { id: assetId },
    data: {
      byteplusGroupId: group.groupId,
      byteplusGroupName: group.groupName,
      byteplusSyncStatus: "SYNCING",
      byteplusSyncError: null,
      // 重试场景：清空原 byteplusAssetId 让 doByteplusCreateAsset 重新创建
      byteplusAssetId: null,
    },
  });
  void doByteplusCreateAsset(assetId).catch(() => undefined);
  return { status: "SYNCING" };
}

// ──────────────────────────────────────────────
// Worker 端：视频结果 + 尾帧（P1-B 用）
// ──────────────────────────────────────────────

/**
 * Worker 调用：把 Seedance 生成的视频提升为 SeriesAsset。
 */
export async function createSeriesAssetForVideoResult(input: {
  seriesId: string;
  projectId: string;
  storyboardId: string;
  generationTaskId: string;
  episodeNumber: number;
  storyboardCode: string;
  videoBuffer: Buffer;
  probe: ProbeResult;
  createdBy: string;
}) {
  const { displayName, byteplusName } = buildVideoAssetName({
    episodeNumber: input.episodeNumber,
    storyboardId: input.storyboardCode,
  });
  const assetId = newAssetId();
  const objectKey = buildOssObjectKey({
    seriesId: input.seriesId,
    assetId,
    ext: "mp4",
    kind: "video",
    episodeNumber: input.episodeNumber,
    storyboardId: input.storyboardCode,
  });
  const uploaded = await uploadBuffer(objectKey, input.videoBuffer, { contentType: input.probe.mimeType });
  const asset = await prisma.seriesAsset.create({
    data: {
      id: assetId,
      seriesId: input.seriesId,
      projectId: input.projectId,
      storyboardId: input.storyboardId,
      generationTaskId: input.generationTaskId,
      name: displayName,
      normalizedName: normalizeAssetName(displayName),
      type: "VIDEO",
      source: "VIDEO_RESULT",
      mimeType: input.probe.mimeType,
      bytes: input.probe.bytes,
      width: input.probe.width,
      height: input.probe.height,
      durationSec: input.probe.durationSec,
      fps: input.probe.fps,
      ossBucket: uploaded.bucket,
      ossObjectKey: uploaded.objectKey,
      ossPublicUrl: uploaded.publicUrl,
      byteplusAssetName: byteplusName,
      byteplusAssetType: "Video",
      byteplusSyncStatus: "NOT_SYNCED",
      createdBy: input.createdBy,
    },
  });
  await maybeTriggerByteplusSync(asset.id, asset.seriesId);
  return asset;
}

/**
 * Worker 调用：把视频尾帧提升为 SeriesAsset。
 */
export async function createSeriesAssetForTailFrame(input: {
  seriesId: string;
  projectId: string;
  storyboardId: string;
  generationTaskId: string;
  episodeNumber: number;
  storyboardCode: string;
  frameBuffer: Buffer;
  probe: ProbeResult;
  createdBy: string;
}) {
  const { displayName, byteplusName } = buildTailFrameAssetName({
    episodeNumber: input.episodeNumber,
    storyboardId: input.storyboardCode,
  });
  const assetId = newAssetId();
  const objectKey = buildOssObjectKey({
    seriesId: input.seriesId,
    assetId,
    ext: "png",
    kind: "tail_frame",
    episodeNumber: input.episodeNumber,
    storyboardId: input.storyboardCode,
  });
  const uploaded = await uploadBuffer(objectKey, input.frameBuffer, { contentType: input.probe.mimeType });
  const asset = await prisma.seriesAsset.create({
    data: {
      id: assetId,
      seriesId: input.seriesId,
      projectId: input.projectId,
      storyboardId: input.storyboardId,
      generationTaskId: input.generationTaskId,
      name: displayName,
      normalizedName: normalizeAssetName(displayName),
      type: "IMAGE",
      source: "VIDEO_TAIL_FRAME",
      mimeType: input.probe.mimeType,
      bytes: input.probe.bytes,
      width: input.probe.width,
      height: input.probe.height,
      ossBucket: uploaded.bucket,
      ossObjectKey: uploaded.objectKey,
      ossPublicUrl: uploaded.publicUrl,
      byteplusAssetName: byteplusName,
      byteplusAssetType: "Image",
      byteplusSyncStatus: "NOT_SYNCED",
      createdBy: input.createdBy,
    },
  });
  await maybeTriggerByteplusSync(asset.id, asset.seriesId);
  return asset;
}

/**
 * Canvas 同步：把 CanvasAsset 提升为 SeriesAsset。
 *
 * 实现方式：从 CanvasAsset 读 publicUrl（或 GCS path）→ 下载二进制 → 上传 OSS（OSS 是新链路 SoT）→ 建 SeriesAsset 行。
 * Canvas 端原 CanvasAsset 保留不变，可继续用作 Canvas 内部引用。
 */
export async function createSeriesAssetFromCanvas(input: {
  seriesId: string;
  canvasProjectId: string;
  canvasAssetId: string;
  rawName: string;
  buffer: Buffer;
  probe: ProbeResult;
  createdBy: string;
}) {
  const nameCheck = validateAssetName(input.rawName);
  if (!nameCheck.ok) {
    throw new SeriesAssetError(400, "INVALID_NAME", nameCheck.error!);
  }
  const normalizedName = normalizeAssetName(input.rawName);
  const dup = await prisma.seriesAsset.findUnique({
    where: { seriesId_normalizedName: { seriesId: input.seriesId, normalizedName } },
    select: { id: true },
  });
  if (dup) {
    throw new SeriesAssetError(409, "DUPLICATE_NAME", `同名资产已存在: ${input.rawName}`);
  }

  const assetId = newAssetId();
  const ext = extFromMime(input.probe.mimeType);
  const objectKey = buildOssObjectKey({
    seriesId: input.seriesId,
    assetId,
    ext,
    kind: "upload",
  });
  const uploaded = await uploadBuffer(objectKey, input.buffer, { contentType: input.probe.mimeType });

  const asset = await prisma.seriesAsset.create({
    data: {
      id: assetId,
      seriesId: input.seriesId,
      canvasProjectId: input.canvasProjectId,
      canvasAssetId: input.canvasAssetId,
      name: input.rawName,
      normalizedName,
      type: input.probe.type,
      source: "CANVAS_GENERATED",
      mimeType: input.probe.mimeType,
      bytes: input.probe.bytes,
      width: input.probe.width,
      height: input.probe.height,
      ossBucket: uploaded.bucket,
      ossObjectKey: uploaded.objectKey,
      ossPublicUrl: uploaded.publicUrl,
      byteplusAssetName: input.rawName,
      byteplusAssetType: probeTypeToByteplus(input.probe.type),
      // Canvas 是手动同步链路：默认 NOT_SYNCED，等用户点"同步"才进 SYNCING
      byteplusSyncStatus: "NOT_SYNCED",
      createdBy: input.createdBy,
    },
  });
  return asset;
}
