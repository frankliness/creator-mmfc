/**
 * v2.0.0：Series Asset Group 业务层（Admin）。
 *
 * 设计原则：BytePlus 网络调用永远在 DB 事务之外，避免长事务占锁。
 * 创建/绑定失败时，SeriesAssetGroup 行落 status=FAILED，Series 本身不受影响。
 */

import { prisma } from "../../common/prisma.js";
import {
  createAssetGroup,
  listAssetGroups as listByteplusGroups,
  ByteplusApiError,
  type AssetGroupSummary,
} from "../../common/byteplus-asset.js";

export type AssetGroupBindMode = "bind" | "create";

export interface BindAssetGroupInput {
  /** 绑定模式：bind=使用已有 BytePlus Group；create=调 BytePlus 创建新 Group */
  mode: AssetGroupBindMode;
  /** mode=bind 时必填：已有 BytePlus groupId */
  groupId?: string;
  /** mode=create 时必填；mode=bind 时可选（覆盖展示名） */
  groupName?: string;
  description?: string;
  projectName?: string;
}

export interface AssetGroupRow {
  id: string;
  seriesId: string;
  provider: string;
  groupId: string | null;
  groupName: string;
  groupType: string;
  projectName: string;
  status: string;
  error: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_GROUP_NAME_LENGTH = 64;

function validateGroupName(name: string): string | null {
  const t = name.trim();
  if (t.length === 0) return "Asset Group 名称不能为空";
  if (t.length > MAX_GROUP_NAME_LENGTH) return `Asset Group 名称最大 ${MAX_GROUP_NAME_LENGTH} 字符`;
  if (/[/\\?#%&=\r\n\t]/.test(t)) return "Asset Group 名称不允许包含 / \\ ? # % & = 或换行/制表符";
  return null;
}

/**
 * 为指定 Series 绑定 / 创建 Asset Group。
 *
 * 流程：
 *   1. 校验 Series 存在且未绑过 Group（已绑过应走 rebind 接口）
 *   2. mode=create：调 BytePlus createAssetGroup
 *      mode=bind：从 BytePlus 已有 Group 拉详情或直接信任传入的 groupId/groupName
 *   3. 不论成功失败都 upsert SeriesAssetGroup（status=ACTIVE / FAILED）
 *
 * 失败时本函数不会 throw —— 错误信息记录在 SeriesAssetGroup.error，调用方按行 status 处理。
 */
export async function bindOrCreateAssetGroup(
  seriesId: string,
  input: BindAssetGroupInput,
  operatorId: string,
): Promise<AssetGroupRow> {
  // 校验：Series 必须存在
  const series = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) throw new Error("Series 不存在");

  // mode 校验
  if (input.mode === "create" && !input.groupName) {
    throw new Error("create 模式必须提供 groupName");
  }
  if (input.mode === "bind" && !input.groupId) {
    throw new Error("bind 模式必须提供 groupId");
  }
  if (input.groupName) {
    const err = validateGroupName(input.groupName);
    if (err) throw new Error(err);
  }

  // 已有绑定记录则直接更新（重试 / 改绑场景）
  const existing = await prisma.seriesAssetGroup.findUnique({ where: { seriesId } });

  if (input.mode === "bind") {
    const row = await prisma.seriesAssetGroup.upsert({
      where: { seriesId },
      create: {
        seriesId,
        provider: "byteplus",
        groupId: input.groupId!,
        groupName: input.groupName ?? input.groupId!,
        groupType: "AIGC",
        projectName: input.projectName ?? "default",
        status: "ACTIVE",
        error: null,
        createdBy: operatorId,
      },
      update: {
        groupId: input.groupId!,
        groupName: input.groupName ?? existing?.groupName ?? input.groupId!,
        projectName: input.projectName ?? existing?.projectName ?? "default",
        status: "ACTIVE",
        error: null,
      },
    });
    return row;
  }

  // mode = create
  try {
    const result = await createAssetGroup({
      groupName: input.groupName!,
      description: input.description,
      projectName: input.projectName,
    });
    const row = await prisma.seriesAssetGroup.upsert({
      where: { seriesId },
      create: {
        seriesId,
        provider: "byteplus",
        groupId: result.groupId,
        groupName: result.groupName,
        groupType: result.groupType,
        projectName: result.projectName,
        status: "ACTIVE",
        error: null,
        createdBy: operatorId,
      },
      update: {
        groupId: result.groupId,
        groupName: result.groupName,
        groupType: result.groupType,
        projectName: result.projectName,
        status: "ACTIVE",
        error: null,
      },
    });
    return row;
  } catch (err) {
    const errorMessage = err instanceof ByteplusApiError
      ? `BytePlus 错误 (${err.status}): ${err.message}`
      : err instanceof Error
        ? err.message
        : "BytePlus 创建 Group 失败";
    const row = await prisma.seriesAssetGroup.upsert({
      where: { seriesId },
      create: {
        seriesId,
        provider: "byteplus",
        groupId: null,
        groupName: input.groupName!,
        groupType: "AIGC",
        projectName: input.projectName ?? "default",
        status: "FAILED",
        error: errorMessage,
        createdBy: operatorId,
      },
      update: {
        groupId: null,
        groupName: input.groupName!,
        projectName: input.projectName ?? existing?.projectName ?? "default",
        status: "FAILED",
        error: errorMessage,
      },
    });
    return row;
  }
}

/**
 * 查询当前 Series 的 Asset Group 绑定。
 */
export async function getAssetGroup(seriesId: string): Promise<AssetGroupRow | null> {
  return prisma.seriesAssetGroup.findUnique({ where: { seriesId } });
}

/**
 * 列出 BytePlus 账号下的 Asset Group（Admin 端选择已有 Group 用）。
 * 失败时直接抛错（与 bindOrCreateAssetGroup 不同 —— 这里是查询接口，需要明确报错）。
 */
export async function searchByteplusAssetGroups(input?: {
  keyword?: string;
  projectName?: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<{ items: AssetGroupSummary[]; nextPageToken?: string }> {
  const result = await listByteplusGroups(input);
  return { items: result.items, nextPageToken: result.nextPageToken };
}

/**
 * 解绑 Series 的 Asset Group（保留行，status=UNBOUND）。
 * 注意：不会删除 BytePlus 上的 Group（避免影响其它使用），只在本地软解绑。
 */
export async function unbindAssetGroup(seriesId: string): Promise<AssetGroupRow | null> {
  const existing = await prisma.seriesAssetGroup.findUnique({ where: { seriesId } });
  if (!existing) return null;
  return prisma.seriesAssetGroup.update({
    where: { seriesId },
    data: { status: "UNBOUND", groupId: null },
  });
}
