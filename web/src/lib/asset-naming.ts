/**
 * v2.0.0：Series 素材命名规则 + OSS object key 构造。
 *
 * 命名规则（PRD 第六节）：
 *  - Asset Group Name / Asset Name 最大 64 字符（BytePlus 限制）
 *  - 同 Series 全类型唯一（IMAGE / VIDEO / AUDIO 共享命名空间）
 *  - 不允许 / \ ? # % & =，不允许换行、制表符
 *  - 中文允许：normalizedName 仅做 trim + 小写化 + 空白折叠
 *
 * OSS object key 设计（中文命名兼容方案）：
 *  - 数据库 SeriesAsset.name 保留用户原始中文输入
 *  - OSS key 完全用稳定 UUID，永远不含中文，避免 ali-oss URL 转义问题
 *  - BytePlus AssetName 用展示名（支持中文模糊搜索）
 */

export const MAX_ASSET_NAME_LENGTH = 64;
export const MAX_GROUP_NAME_LENGTH = 64;

const ILLEGAL_CHARS_REGEX = /[/\\?#%&=\r\n\t]/;
/** 多个空白（含全角空格 U+3000）折叠为单个半角空格 */
const WHITESPACE_RUN_REGEX = /[\s　]+/g;

export type AssetType = "IMAGE" | "VIDEO" | "AUDIO";

export type AssetKind =
  | "upload" // 手动上传 / Canvas 同步
  | "video" // Seedance 视频结果
  | "tail_frame"; // Seedance 视频尾帧

export interface ValidateResult {
  ok: boolean;
  /** 仅在 ok=false 时存在 */
  error?: string;
}

/**
 * 归一化资产名：trim → 小写化 → 空白折叠为单空格。
 * 用于 SeriesAsset.normalizedName 字段，保证 (seriesId, normalizedName) 唯一性判重。
 *
 * 不会移除中文字符，因为 BytePlus AssetName 支持中文模糊搜索。
 */
export function normalizeAssetName(raw: string): string {
  return raw.trim().toLowerCase().replace(WHITESPACE_RUN_REGEX, " ");
}

/**
 * 校验资产名是否合法。
 * - 必填，trim 后长度 > 0
 * - 最大 64 字符（按 JavaScript 的 UTF-16 code units 计数，与 BytePlus 文档一致）
 * - 不允许：/ \ ? # % & = 及任意换行/制表符
 *
 * 注意：唯一性判重需要查库，不在此函数中处理。
 */
export function validateAssetName(raw: string): ValidateResult {
  if (typeof raw !== "string") return { ok: false, error: "名称必须为字符串" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "名称不能为空" };
  if (trimmed.length > MAX_ASSET_NAME_LENGTH) {
    return { ok: false, error: `名称最大 ${MAX_ASSET_NAME_LENGTH} 字符` };
  }
  if (ILLEGAL_CHARS_REGEX.test(trimmed)) {
    return { ok: false, error: "名称不允许包含 / \\ ? # % & = 或换行/制表符" };
  }
  return { ok: true };
}

/**
 * 校验 Asset Group 名（同 validateAssetName，规则相同）。
 */
export function validateGroupName(raw: string): ValidateResult {
  return validateAssetName(raw);
}

/**
 * 从 mime type 推断文件扩展名。OSS object key 使用，必须返回安全 ASCII。
 * 未知 mime 返回 "bin"。
 */
export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  switch (m) {
    case "image/png": return "png";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "audio/mpeg": return "mp3";
    case "audio/wav":
    case "audio/x-wav": return "wav";
    case "audio/mp4":
    case "audio/aac": return "m4a";
    case "audio/ogg": return "ogg";
    default: return "bin";
  }
}

export interface BuildOssKeyInput {
  seriesId: string;
  /** 资产 UUID（数据库 SeriesAsset.id），用作 OSS key 的稳定标识 */
  assetId: string;
  /** 文件扩展名（不含点），由 extFromMime 推导 */
  ext: string;
  kind: AssetKind;
  /** kind=video / tail_frame 必填：用于按集数分目录 */
  episodeNumber?: number;
  /** kind=video / tail_frame 必填：用于落 storyboardId 后缀 */
  storyboardId?: string;
}

/**
 * 构造 OSS object key。永远不含中文，便于 URL 直接访问、缓存、CDN 配置。
 *
 * 路径规则：
 *  - upload:     series/{seriesId}/assets/{assetId}.{ext}
 *  - video:      series/{seriesId}/episodes/EP{n}/{storyboardId}_video.mp4
 *  - tail_frame: series/{seriesId}/episodes/EP{n}/{storyboardId}_tail.{ext}
 */
export function buildOssObjectKey(input: BuildOssKeyInput): string {
  const { seriesId, assetId, ext, kind, episodeNumber, storyboardId } = input;
  switch (kind) {
    case "upload":
      return `series/${seriesId}/assets/${assetId}.${ext}`;
    case "video": {
      if (episodeNumber == null || !storyboardId) {
        throw new Error("buildOssObjectKey(video): episodeNumber 和 storyboardId 必填");
      }
      return `series/${seriesId}/episodes/EP${episodeNumber}/${storyboardId}_video.${ext}`;
    }
    case "tail_frame": {
      if (episodeNumber == null || !storyboardId) {
        throw new Error("buildOssObjectKey(tail_frame): episodeNumber 和 storyboardId 必填");
      }
      return `series/${seriesId}/episodes/EP${episodeNumber}/${storyboardId}_tail.${ext}`;
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`buildOssObjectKey: 未知 kind ${_exhaustive}`);
    }
  }
}

/**
 * Worker 自动命名：Seedance 视频结果资产展示名 + BytePlus AssetName。
 * 展示名："第 {n} 集-{storyboardId}-视频"
 * BytePlus name："EP{n}_{storyboardId}_video"（ASCII，便于 BytePlus 后台搜索）
 */
export function buildVideoAssetName(input: { episodeNumber: number; storyboardId: string }): {
  displayName: string;
  byteplusName: string;
} {
  return {
    displayName: `第 ${input.episodeNumber} 集-${input.storyboardId}-视频`,
    byteplusName: `EP${input.episodeNumber}_${input.storyboardId}_video`,
  };
}

/**
 * Worker 自动命名：Seedance 视频尾帧资产展示名 + BytePlus AssetName。
 */
export function buildTailFrameAssetName(input: { episodeNumber: number; storyboardId: string }): {
  displayName: string;
  byteplusName: string;
} {
  return {
    displayName: `第 ${input.episodeNumber} 集-${input.storyboardId}-尾帧`,
    byteplusName: `EP${input.episodeNumber}_${input.storyboardId}_tail_frame`,
  };
}

/**
 * 自检（手动调用，仅在开发期跑）。
 * 不引入测试框架，但保留可读断言文档化预期行为。
 */
export function __debugSelfTest(): void {
  const eq = (a: unknown, b: unknown, msg: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`SELFTEST FAIL: ${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
    }
  };
  // normalize
  eq(normalizeAssetName("  Hello World  "), "hello world", "trim + lower");
  eq(normalizeAssetName("Hello  World"), "hello world", "collapse spaces");
  eq(normalizeAssetName("伊莎贝拉　公主"), "伊莎贝拉 公主", "full-width space normalized");
  eq(normalizeAssetName("EP1_s001_video"), "ep1_s001_video", "lowercase symbols preserved");
  // validate
  eq(validateAssetName("").ok, false, "empty rejected");
  eq(validateAssetName("a".repeat(65)).ok, false, "over 64 rejected");
  eq(validateAssetName("a".repeat(64)).ok, true, "64 allowed");
  eq(validateAssetName("foo/bar").ok, false, "slash rejected");
  eq(validateAssetName("foo\nbar").ok, false, "newline rejected");
  eq(validateAssetName("伊莎贝拉").ok, true, "chinese allowed");
  // ext
  eq(extFromMime("image/png"), "png", "png ext");
  eq(extFromMime("application/x-nonexistent"), "bin", "unknown ext");
  // OSS key
  eq(
    buildOssObjectKey({ seriesId: "s1", assetId: "a1", ext: "png", kind: "upload" }),
    "series/s1/assets/a1.png",
    "upload key",
  );
  eq(
    buildOssObjectKey({ seriesId: "s1", assetId: "a1", ext: "mp4", kind: "video", episodeNumber: 3, storyboardId: "sb01" }),
    "series/s1/episodes/EP3/sb01_video.mp4",
    "video key",
  );
}
