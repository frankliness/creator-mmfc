import * as fs from "fs";
import * as path from "path";

/**
 * 与用户端 canvas-storage 目录约定一致：IMAGE_STORAGE_PATH/userId/projectId/file
 * 管理端仅做本地 unlink，不引入 GCS SDK（避免新增依赖）。
 */
export function deleteLocalCanvasAsset(localPath: string | null | undefined): void {
  if (!localPath) return;
  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch (err) {
    console.error("[canvas-files] local unlink failed:", err);
  }
}

export function resolveImageStorageDir(): string {
  const raw = process.env.IMAGE_STORAGE_PATH || "./data/canvas-images";
  return path.resolve(raw);
}
