import * as fs from "fs";
import * as path from "path";
import { Storage } from "@google-cloud/storage";
import { probeAsset } from "@/lib/asset-metadata-probe";
import {
  createSeriesAssetForVideoResult,
  createSeriesAssetForTailFrame,
} from "@/lib/series-asset-service";
import { extractLastFrameFromFile } from "@/lib/ffmpeg-extract-frame";

const rawDir = process.env.VIDEO_STORAGE_PATH || "./data/videos";
const VIDEO_DIR = path.resolve(rawDir);

/** 仅保留文件名/GCS object 安全字符，其余替换为 `_`。 */
function sanitizeFilenameSegment(segment: string): string {
  const t = segment.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
  const trimmed = t.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : "x";
}

/** 本地与 GCS 统一：`{storyboardId}_{arkTaskId}`（不含扩展名）。 */
export function buildVideoBasename(
  storyboardId: string,
  arkTaskId: string
): string {
  return `${sanitizeFilenameSegment(storyboardId)}_${sanitizeFilenameSegment(arkTaskId)}`;
}

function resolveCredentialsPath(): void {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p || p.startsWith("-----BEGIN")) return;
  if (!path.isAbsolute(p)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(process.cwd(), p);
  }
}

export async function downloadVideo(
  videoUrl: string,
  videoBasename: string
): Promise<string> {
  if (!fs.existsSync(VIDEO_DIR)) {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
  }

  const filename = `${videoBasename}.mp4`;
  const filePath = path.join(VIDEO_DIR, filename);

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const stats = fs.statSync(filePath);
  console.log(
    `[video-persist] downloaded ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`
  );

  return filePath;
}

export async function uploadToGCS(
  localPath: string,
  videoBasename: string,
  meta: { storyboardId: string; arkTaskId: string }
): Promise<string> {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error("GCS_BUCKET not configured");
  }

  resolveCredentialsPath();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !fs.existsSync(credPath)) {
    throw new Error(
      `GOOGLE_APPLICATION_CREDENTIALS 无效或文件不存在: ${credPath || "(未设置)"}`
    );
  }

  const storage = new Storage();
  const destination = `seedance/${videoBasename}.mp4`;

  await storage.bucket(bucket).upload(localPath, {
    destination,
    metadata: {
      contentType: "video/mp4",
      metadata: {
        arkTaskId: meta.arkTaskId,
        storyboardId: meta.storyboardId,
      },
    },
  });

  const gcsPath = `gs://${bucket}/${destination}`;
  console.log(`[video-persist] uploaded to ${gcsPath}`);
  return gcsPath;
}

// ──────────────────────────────────────────────
// v2.0.0：OSS + SeriesAsset + 尾帧自动资产化
// ──────────────────────────────────────────────

/**
 * Series 项目的视频结果资产化：
 *   1. 上传视频到 OSS（series/{seriesId}/episodes/EP{n}/{storyboardCode}_video.mp4）
 *   2. 创建 SeriesAsset(source=VIDEO_RESULT)
 *   3. 触发 BytePlus 同步
 * 返回 SeriesAsset.id + OSS key/url，调用方写回 GenerationTask。
 */
export async function persistVideoAsSeriesAsset(input: {
  localVideoPath: string;
  seriesId: string;
  projectId: string;
  storyboardId: string;
  generationTaskId: string;
  episodeNumber: number;
  storyboardCode: string;
  createdBy: string;
}): Promise<{ assetId: string; ossObjectKey: string; ossPublicUrl: string }> {
  const videoBuffer = await fs.promises.readFile(input.localVideoPath);
  const probe = await probeAsset({ buffer: videoBuffer, mimeType: "video/mp4" });
  const asset = await createSeriesAssetForVideoResult({
    seriesId: input.seriesId,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    generationTaskId: input.generationTaskId,
    episodeNumber: input.episodeNumber,
    storyboardCode: input.storyboardCode,
    videoBuffer,
    probe,
    createdBy: input.createdBy,
  });
  return {
    assetId: asset.id,
    ossObjectKey: asset.ossObjectKey,
    ossPublicUrl: asset.ossPublicUrl,
  };
}

/**
 * Series 项目的尾帧资产化：
 *   1. 优先用 lastFrameUrl 下载（Seedance API 返回）
 *   2. 缺失时从本地 mp4 用 ffmpeg 抽末帧
 *   3. 上传 OSS → 创建 SeriesAsset(source=VIDEO_TAIL_FRAME) → 触发 BytePlus 同步
 */
export async function persistTailFrameAsSeriesAsset(input: {
  localVideoPath: string;
  lastFrameUrl: string | null;
  seriesId: string;
  projectId: string;
  storyboardId: string;
  generationTaskId: string;
  episodeNumber: number;
  storyboardCode: string;
  createdBy: string;
}): Promise<{ assetId: string; mode: "api" | "ffmpeg" } | null> {
  let frameBuffer: Buffer | null = null;
  let mode: "api" | "ffmpeg" = "ffmpeg";

  if (input.lastFrameUrl) {
    try {
      const res = await fetch(input.lastFrameUrl);
      if (res.ok) {
        frameBuffer = Buffer.from(await res.arrayBuffer());
        mode = "api";
      } else {
        console.warn(`[video-persist] last_frame_url 下载失败 ${res.status}，回退 ffmpeg 抽帧`);
      }
    } catch (e) {
      console.warn(
        `[video-persist] last_frame_url 下载异常，回退 ffmpeg 抽帧:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (!frameBuffer) {
    try {
      frameBuffer = await extractLastFrameFromFile(input.localVideoPath);
    } catch (e) {
      console.error(
        `[video-persist] ffmpeg 抽帧失败：`,
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }

  const probe = await probeAsset({ buffer: frameBuffer, mimeType: "image/png" });
  const asset = await createSeriesAssetForTailFrame({
    seriesId: input.seriesId,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    generationTaskId: input.generationTaskId,
    episodeNumber: input.episodeNumber,
    storyboardCode: input.storyboardCode,
    frameBuffer,
    probe,
    createdBy: input.createdBy,
  });
  return { assetId: asset.id, mode };
}

