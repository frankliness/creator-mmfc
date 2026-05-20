/**
 * v2.0.0：上传资产前的 metadata probe。
 *
 * 图片：sharp（轻量、纯 native）
 * 视频/音频：fluent-ffmpeg + @ffprobe-installer/ffprobe（捆绑 ffprobe 二进制，跨平台无系统依赖）
 *
 * 设计原则：probe 必须能在内存 Buffer 上完成，避免视频写临时盘后才能读元信息。
 * ffprobe 不支持 stdin 直读 Buffer → 我们写到 OS 临时目录再读，函数返回前 cleanup。
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { randomUUID } from "crypto";

ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export type ProbeAssetType = "IMAGE" | "VIDEO" | "AUDIO";

export interface ProbeResult {
  type: ProbeAssetType;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  fps?: number;
}

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/m4a",
]);

export function inferAssetType(mime: string): ProbeAssetType | null {
  const m = mime.toLowerCase();
  if (IMAGE_MIMES.has(m) || m.startsWith("image/")) return "IMAGE";
  if (VIDEO_MIMES.has(m) || m.startsWith("video/")) return "VIDEO";
  if (AUDIO_MIMES.has(m) || m.startsWith("audio/")) return "AUDIO";
  return null;
}

export async function probeAsset(input: { buffer: Buffer; mimeType: string }): Promise<ProbeResult> {
  const type = inferAssetType(input.mimeType);
  if (!type) {
    throw new Error(`不支持的文件类型: ${input.mimeType}`);
  }

  const bytes = input.buffer.byteLength;

  if (type === "IMAGE") {
    const meta = await sharp(input.buffer).metadata();
    return {
      type,
      mimeType: input.mimeType,
      bytes,
      width: meta.width,
      height: meta.height,
    };
  }

  // VIDEO / AUDIO 用 ffprobe；先写临时文件
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mmfc-probe-"));
  const tmpFile = path.join(tmpDir, randomUUID());
  await fs.writeFile(tmpFile, input.buffer);
  try {
    const data = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(tmpFile, (err, info) => {
        if (err) reject(err);
        else resolve(info);
      });
    });
    const stream = (data.streams ?? []).find((s) => s.codec_type === (type === "VIDEO" ? "video" : "audio"));
    const durationSec = typeof data.format?.duration === "number"
      ? data.format.duration
      : parseFloat(String(data.format?.duration ?? "")) || undefined;
    const result: ProbeResult = {
      type,
      mimeType: input.mimeType,
      bytes,
      durationSec,
    };
    if (type === "VIDEO" && stream) {
      result.width = stream.width;
      result.height = stream.height;
      // r_frame_rate 形如 "30000/1001" 或 "25/1"
      const rate = stream.r_frame_rate;
      if (rate && typeof rate === "string" && rate.includes("/")) {
        const [num, den] = rate.split("/").map(Number);
        if (num && den) result.fps = num / den;
      }
    }
    return result;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
