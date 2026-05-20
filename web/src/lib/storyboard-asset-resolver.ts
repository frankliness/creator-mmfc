/**
 * v2.0.0：分镜资产 → Seedance content[] 解析器。
 *
 * 负责：
 *  1. 读取 Storyboard.generationMode + assetRefs（结构化字段）
 *  2. 校验 Series 已绑定 ACTIVE Asset Group
 *  3. 校验所有引用资产属于该 Group 且 byteplusSyncStatus=SYNCED
 *  4. 校验生成模式互斥（FIRST_FRAME 禁用 reference_*；MULTIMODAL 不能只有音频）
 *  5. 校验数量/时长约束（图≤9，视频≤3 且总时长≤15s）
 *  6. 输出 Seedance content 数组，全部使用 asset://<byteplusAssetId> 协议
 *
 * 校验失败时抛 StoryboardResolveError，调用方映射到 4xx 响应。
 */

import { prisma } from "./prisma";

export class StoryboardResolveError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type GenerationMode = "FIRST_FRAME" | "MULTIMODAL";

export interface AssetRefs {
  /** 首帧 assetId（FIRST_FRAME 模式必填） */
  first_frame_asset_id?: string | null;
  /** 尾帧 assetId（FIRST_FRAME 模式可选；MULTIMODAL 禁用） */
  last_frame_asset_id?: string | null;
  /** 参考图 assetId 数组（MULTIMODAL 模式 1-9 张；FIRST_FRAME 模式禁用） */
  reference_image_asset_ids?: string[];
  /** 参考视频 assetId 数组（MULTIMODAL 模式 ≤3 个且总时长 ≤15s；FIRST_FRAME 模式禁用） */
  reference_video_asset_ids?: string[];
  /** 参考音频 assetId（MULTIMODAL 模式可选；FIRST_FRAME 模式禁用） */
  reference_audio_asset_id?: string | null;
}

export interface ResolvedContentItem {
  type: "image_url" | "video_url" | "audio_url";
  /** Seedance API 接收的字段；图片是 image_url.url，视频是 video_url.url 等 */
  payload: Record<string, unknown>;
}

const MAX_REF_IMAGES = 9;
const MAX_REF_VIDEOS = 3;
const MAX_REF_VIDEO_TOTAL_DURATION_SEC = 15;

/**
 * 解析分镜资产并校验，返回可直接喂给 Seedance API 的 content[] 数组。
 */
export async function resolveStoryboardAssetsForSeedance(
  storyboardId: string,
): Promise<{
  contentItems: ResolvedContentItem[];
  mode: GenerationMode;
  groupId: string;
}> {
  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      generationMode: true,
      assetRefs: true,
      project: {
        select: { id: true, seriesId: true },
      },
    },
  });
  if (!storyboard) {
    throw new StoryboardResolveError(404, "STORYBOARD_NOT_FOUND", "分镜不存在");
  }
  if (!storyboard.project.seriesId) {
    throw new StoryboardResolveError(400, "LEGACY_PROJECT", "该项目未绑定 Series，无法走新版资产链路");
  }
  if (!storyboard.generationMode || !storyboard.assetRefs) {
    throw new StoryboardResolveError(
      400,
      "MISSING_GENERATION_MODE",
      "分镜未配置生成模式或资产引用，请在分镜编辑页面选择模式并绑定资产",
    );
  }
  const mode = storyboard.generationMode as GenerationMode;
  if (mode !== "FIRST_FRAME" && mode !== "MULTIMODAL") {
    throw new StoryboardResolveError(400, "INVALID_MODE", `非法生成模式: ${mode}`);
  }
  const refs = (storyboard.assetRefs ?? {}) as AssetRefs;
  const seriesId = storyboard.project.seriesId;

  // 1. Series 必须绑定 ACTIVE Group
  const group = await prisma.seriesAssetGroup.findUnique({ where: { seriesId } });
  if (!group || group.status !== "ACTIVE" || !group.groupId) {
    throw new StoryboardResolveError(
      400,
      "GROUP_NOT_ACTIVE",
      "Series 未绑定有效的 BytePlus Asset Group，请先在 Admin 后台配置",
    );
  }

  // 2. 模式互斥校验
  validateModeExclusivity(mode, refs);

  // 3. 收集所有引用的 assetId
  const allAssetIds = collectAssetIds(refs);
  if (allAssetIds.length === 0) {
    throw new StoryboardResolveError(400, "NO_ASSETS", "分镜未绑定任何资产");
  }

  // 4. 一次拉取所有资产记录
  const assets = await prisma.seriesAsset.findMany({
    where: { id: { in: allAssetIds }, seriesId },
  });
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // 5. 校验：每个 id 都存在、属于当前 Group、SYNCED
  for (const id of allAssetIds) {
    const a = assetMap.get(id);
    if (!a) {
      throw new StoryboardResolveError(400, "ASSET_NOT_FOUND", `资产不存在或不属于当前 Series: ${id}`);
    }
    if (a.byteplusGroupId !== group.groupId) {
      throw new StoryboardResolveError(
        400,
        "ASSET_GROUP_MISMATCH",
        `资产 "${a.name}" 不属于当前 Series 绑定的 Group`,
      );
    }
    if (a.byteplusSyncStatus !== "SYNCED" || !a.byteplusAssetId) {
      throw new StoryboardResolveError(
        400,
        "ASSET_NOT_SYNCED",
        `资产 "${a.name}" 未同步到 BytePlus（当前状态：${a.byteplusSyncStatus}）`,
      );
    }
  }

  // 6. 视频数量 + 总时长约束
  if (mode === "MULTIMODAL") {
    const videoIds = refs.reference_video_asset_ids ?? [];
    if (videoIds.length > 0) {
      let totalDuration = 0;
      for (const id of videoIds) {
        const a = assetMap.get(id);
        if (a?.type !== "VIDEO") {
          throw new StoryboardResolveError(400, "INVALID_VIDEO_REF", `资产 "${a?.name ?? id}" 不是视频类型`);
        }
        totalDuration += a.durationSec ?? 0;
      }
      if (totalDuration > MAX_REF_VIDEO_TOTAL_DURATION_SEC) {
        throw new StoryboardResolveError(
          400,
          "VIDEO_DURATION_EXCEEDED",
          `参考视频总时长 ${totalDuration.toFixed(1)}s 超过 ${MAX_REF_VIDEO_TOTAL_DURATION_SEC}s 限制`,
        );
      }
    }
  }

  // 7. 输出 Seedance content[]
  const contentItems: ResolvedContentItem[] = [];

  const toAssetUri = (assetId: string) => {
    const a = assetMap.get(assetId)!;
    return `asset://${a.byteplusAssetId}`;
  };

  if (mode === "FIRST_FRAME") {
    contentItems.push({
      type: "image_url",
      payload: { type: "image_url", image_url: { url: toAssetUri(refs.first_frame_asset_id!) }, role: "first_frame" },
    });
    if (refs.last_frame_asset_id) {
      contentItems.push({
        type: "image_url",
        payload: { type: "image_url", image_url: { url: toAssetUri(refs.last_frame_asset_id) }, role: "last_frame" },
      });
    }
  } else {
    for (const id of refs.reference_image_asset_ids ?? []) {
      contentItems.push({
        type: "image_url",
        payload: { type: "image_url", image_url: { url: toAssetUri(id) }, role: "reference_image" },
      });
    }
    for (const id of refs.reference_video_asset_ids ?? []) {
      contentItems.push({
        type: "video_url",
        payload: { type: "video_url", video_url: { url: toAssetUri(id) }, role: "reference_video" },
      });
    }
    if (refs.reference_audio_asset_id) {
      contentItems.push({
        type: "audio_url",
        payload: { type: "audio_url", audio_url: { url: toAssetUri(refs.reference_audio_asset_id) }, role: "reference_audio" },
      });
    }
  }

  return { contentItems, mode, groupId: group.groupId };
}

function validateModeExclusivity(mode: GenerationMode, refs: AssetRefs): void {
  if (mode === "FIRST_FRAME") {
    if (!refs.first_frame_asset_id) {
      throw new StoryboardResolveError(400, "MISSING_FIRST_FRAME", "首帧/尾帧模式：必须指定首帧资产");
    }
    if ((refs.reference_image_asset_ids?.length ?? 0) > 0
      || (refs.reference_video_asset_ids?.length ?? 0) > 0
      || refs.reference_audio_asset_id) {
      throw new StoryboardResolveError(
        400,
        "MODE_CONFLICT",
        "首帧/尾帧模式禁止使用参考图 / 参考视频 / 参考音频",
      );
    }
  } else {
    // MULTIMODAL
    if (refs.first_frame_asset_id || refs.last_frame_asset_id) {
      throw new StoryboardResolveError(
        400,
        "MODE_CONFLICT",
        "多模态参考模式禁止使用首帧 / 尾帧字段",
      );
    }
    const imgCount = refs.reference_image_asset_ids?.length ?? 0;
    const vidCount = refs.reference_video_asset_ids?.length ?? 0;
    if (imgCount === 0 && vidCount === 0 && refs.reference_audio_asset_id) {
      throw new StoryboardResolveError(400, "AUDIO_ONLY", "多模态模式不能只有音频参考");
    }
    if (imgCount === 0 && vidCount === 0 && !refs.reference_audio_asset_id) {
      throw new StoryboardResolveError(400, "NO_ASSETS", "多模态模式至少需要一个图片或视频参考");
    }
    if (imgCount > MAX_REF_IMAGES) {
      throw new StoryboardResolveError(400, "TOO_MANY_IMAGES", `参考图最多 ${MAX_REF_IMAGES} 张`);
    }
    if (vidCount > MAX_REF_VIDEOS) {
      throw new StoryboardResolveError(400, "TOO_MANY_VIDEOS", `参考视频最多 ${MAX_REF_VIDEOS} 个`);
    }
  }
}

function collectAssetIds(refs: AssetRefs): string[] {
  const ids: string[] = [];
  if (refs.first_frame_asset_id) ids.push(refs.first_frame_asset_id);
  if (refs.last_frame_asset_id) ids.push(refs.last_frame_asset_id);
  for (const id of refs.reference_image_asset_ids ?? []) ids.push(id);
  for (const id of refs.reference_video_asset_ids ?? []) ids.push(id);
  if (refs.reference_audio_asset_id) ids.push(refs.reference_audio_asset_id);
  return Array.from(new Set(ids));
}
