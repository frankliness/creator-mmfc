import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";

const rawDir = process.env.IMAGE_STORAGE_PATH || "./data/canvas-images";
const IMAGE_DIR = path.resolve(rawDir);

function sanitize(seg: string): string {
  const t = seg.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
  const trimmed = t.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : "x";
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

export interface SavedAsset {
  id: string;
  localPath: string;
  gcsPath: string | null;
  publicUrl: string;
  bytes: number;
  mimeType: string;
}

/**
 * 把图片字节存到磁盘，可选上传 GCS。
 * publicUrl 始终走 /api/canvas/assets/:id（鉴权后 stream 文件），方便后续替换存储。
 */
export async function saveCanvasImage(params: {
  userId: string;
  projectId: string;
  buffer: Buffer;
  mimeType: string;
  requireGcs?: boolean;
}): Promise<SavedAsset> {
  const id = randomUUID();
  const ext = extFromMime(params.mimeType);

  const dir = path.join(IMAGE_DIR, sanitize(params.userId), sanitize(params.projectId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${id}.${ext}`;
  const localPath = path.join(dir, filename);
  fs.writeFileSync(localPath, params.buffer);

  let gcsPath: string | null = null;
  if (process.env.GCS_BUCKET) {
    try {
      gcsPath = await uploadCanvasImageToGCS(localPath, {
        userId: params.userId,
        projectId: params.projectId,
        filename,
        mimeType: params.mimeType,
      });
    } catch (err) {
      if (params.requireGcs) {
        throw err;
      }
      // GCS 失败不影响主流程；本地副本仍可用
      console.error("[canvas-storage] GCS upload failed (kept local copy):", err);
    }
  } else if (params.requireGcs) {
    throw new Error("GCS_BUCKET 未配置，无法完成图片持久化");
  }

  return {
    id,
    localPath,
    gcsPath,
    publicUrl: `/api/canvas/assets/${id}`,
    bytes: params.buffer.byteLength,
    mimeType: params.mimeType,
  };
}

async function uploadCanvasImageToGCS(
  localPath: string,
  meta: { userId: string; projectId: string; filename: string; mimeType: string }
): Promise<string> {
  const bucket = process.env.GCS_BUCKET!;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !path.isAbsolute(credPath) && !credPath.startsWith("-----BEGIN")) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(process.cwd(), credPath);
  }
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!adc || !fs.existsSync(adc)) {
    throw new Error(
      `GOOGLE_APPLICATION_CREDENTIALS 无效或路径不存在: ${credPath || "(未设置)"}。` +
        `Docker 下请在仓库根 .env 设置 GCS_CREDENTIALS_FILE 指向宿主机上真实存在的 JSON 文件；` +
        `若宿主机缺文件，Compose 可能误建同名目录导致本错误。`
    );
  }
  if (!fs.statSync(adc).isFile()) {
    throw new Error(
      `GOOGLE_APPLICATION_CREDENTIALS 不是文件（常为目录）: ${adc}。` +
        `请删除宿主机误建的目录/文件后，将 GCS_CREDENTIALS_FILE 指到你的服务账号 JSON（例如 ./web/vertexai-*.json），再 docker compose up -d web-app web-worker。`
    );
  }

  const storage = new Storage();
  const destination = `canvas/${sanitize(meta.userId)}/${sanitize(meta.projectId)}/${meta.filename}`;
  await storage.bucket(bucket).upload(localPath, {
    destination,
    metadata: {
      contentType: meta.mimeType,
      metadata: { userId: meta.userId, projectId: meta.projectId },
    },
  });
  return `gs://${bucket}/${destination}`;
}

/** 读取本地文件流；如本地缺失而 gcsPath 存在，从 GCS 拉回。 */
export async function readCanvasAsset(args: {
  localPath: string | null;
  gcsPath: string | null;
}): Promise<{ buffer: Buffer } | null> {
  if (args.localPath && fs.existsSync(args.localPath)) {
    return { buffer: fs.readFileSync(args.localPath) };
  }
  if (args.gcsPath && process.env.GCS_BUCKET) {
    const match = args.gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, bucketName, objectName] = match;
    const storage = new Storage();
    const [buf] = await storage.bucket(bucketName).file(objectName).download();
    return { buffer: buf };
  }
  return null;
}

/** 删除本地与 GCS 副本。失败不抛出，便于批量清理。 */
export async function deleteCanvasAsset(args: {
  localPath: string | null;
  gcsPath: string | null;
}): Promise<void> {
  if (args.localPath) {
    try {
      if (fs.existsSync(args.localPath)) fs.unlinkSync(args.localPath);
    } catch (err) {
      console.error("[canvas-storage] local unlink failed:", err);
    }
  }
  if (args.gcsPath && process.env.GCS_BUCKET) {
    const match = args.gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return;
    try {
      const [, bucketName, objectName] = match;
      await new Storage().bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
    } catch (err) {
      console.error("[canvas-storage] gcs delete failed:", err);
    }
  }
}
