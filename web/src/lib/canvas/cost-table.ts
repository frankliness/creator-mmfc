/**
 * 画布相关的费用预估单价（USD）。后续若要从 GlobalConfig 读取可替换该函数实现。
 * 不在表内的 model 一律返回 null（不抛错），数据库 costEstimate 字段允许 NULL。
 */
type ChatPrice = { kind: "chat"; in: number; out: number };
type ImagePrice = { kind: "image"; perImage: number };

const TABLE: Record<string, ChatPrice | ImagePrice> = {
  // 单位：每 1K token
  "gemini-canvas:gemini-3-flash-preview":         { kind: "chat", in: 0.000075, out: 0.0003 },
  "gemini-canvas:gemini-2.5-flash":               { kind: "chat", in: 0.000075, out: 0.0003 },
  "gemini-canvas:gemini-3-pro-preview":           { kind: "chat", in: 0.00125,  out: 0.005  },
  "gemini-canvas:gemini-2.5-pro":                 { kind: "chat", in: 0.00125,  out: 0.005  },
  // 单位：每张图
  "gemini-canvas:gemini-3.1-flash-image-preview": { kind: "image", perImage: 0.039 },
  "gemini-canvas:gemini-3-pro-image-preview":     { kind: "image", perImage: 0.12  },
};

export function estimateChatCost(model: string, totalTokensIn: bigint, totalTokensOut: bigint): number | null {
  const entry = TABLE[`gemini-canvas:${model}`];
  if (!entry || entry.kind !== "chat") return null;
  const cost =
    (Number(totalTokensIn) / 1000) * entry.in +
    (Number(totalTokensOut) / 1000) * entry.out;
  return Number.isFinite(cost) ? cost : null;
}

export function estimateImageCost(model: string, imageCount: number): number | null {
  const entry = TABLE[`gemini-canvas:${model}`];
  if (!entry || entry.kind !== "image") return null;
  return entry.perImage * Math.max(0, imageCount);
}
