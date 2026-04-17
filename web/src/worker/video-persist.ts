import * as fs from "fs";
import * as path from "path";
import { Storage } from "@google-cloud/storage";

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
