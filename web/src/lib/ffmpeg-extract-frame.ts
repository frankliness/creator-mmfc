/**
 * v2.0.0：ffmpeg 抽帧工具（Worker 用）。
 *
 * 当 Seedance 任务返回的尾帧 URL 缺失时，Worker 从下载到本地的 mp4 文件用 ffmpeg
 * 抽最后一帧作为尾帧 PNG。
 *
 * 依赖：@ffmpeg-installer/ffmpeg + fluent-ffmpeg（已捆绑跨平台二进制）。
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/**
 * 从本地 mp4 文件抽取最后一帧到 PNG buffer。
 * @param videoPath 本地 mp4 路径
 */
export async function extractLastFrameFromFile(videoPath: string): Promise<Buffer> {
  // 先用 ffprobe 拿视频总时长
  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      const d = data?.format?.duration;
      if (typeof d === "number") return resolve(d);
      const dn = parseFloat(String(d ?? ""));
      if (!isNaN(dn)) return resolve(dn);
      reject(new Error("无法解析视频时长"));
    });
  });

  // 取倒数 0.1s 处的帧（避免恰好取到末尾导致空帧）
  const seekTime = Math.max(0, duration - 0.1);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mmfc-frame-"));
  const outPath = path.join(tmpDir, `${randomUUID()}.png`);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(seekTime)
        .frames(1)
        .outputOptions(["-vf", "scale=iw:ih"])
        .output(outPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * 从远端 URL 下载视频再抽尾帧。如果调用方已经有本地 mp4 直接传 path 更高效。
 */
export async function extractLastFrameFromUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载视频失败 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mmfc-mp4-"));
  const tmpFile = path.join(tmpDir, `${randomUUID()}.mp4`);
  await fs.writeFile(tmpFile, buf);
  try {
    return await extractLastFrameFromFile(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
