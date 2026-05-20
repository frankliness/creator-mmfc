import { getGlobalConfig } from "./global-config";

const BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

interface CreateTaskInput {
  prompt: string;
  contentItems: object[];
  duration: number;
  ratio: string;
  resolution: string;
  seed?: number;
  /** v2.0.0：是否在任务结果中返回尾帧 URL。Worker 用于自动资产化尾帧 */
  returnLastFrame?: boolean;
}

interface CreateTaskResponse {
  id: string;
  model: string;
  /** 本次请求 JSON body 中实际使用的 model（与 Ark 响应里的 model 可能不一致） */
  requestedModel: string;
}

export interface ApiConfig {
  apiKey: string;
  endpoint: string;
  model: string;
}

export async function createSeedanceTask(
  input: CreateTaskInput,
  config?: ApiConfig
): Promise<CreateTaskResponse> {
  const apiKey = config?.apiKey
    || await getGlobalConfig("seedance_api_key")
    || process.env.SEEDANCE_API_KEY;
  const endpoint = config?.endpoint
    || await getGlobalConfig("seedance_endpoint")
    || process.env.SEEDANCE_ENDPOINT;
  const model = config?.model || endpoint
    || await getGlobalConfig("seedance_model")
    || process.env.SEEDANCE_MODEL
    || "dreamina-seedance-2-0-260128";

  if (!apiKey) {
    throw new Error("SEEDANCE_API_KEY 未配置");
  }

  const content = [
    { type: "text", text: input.prompt },
    ...input.contentItems,
  ];

  const body: Record<string, unknown> = {
    model,
    content,
    generate_audio: true,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    watermark: false,
  };

  if (input.seed && input.seed > 0) {
    body.seed = input.seed;
  }

  // v2.0.0：开启尾帧返回。Worker 会在轮询结果时从原始响应解析尾帧 URL
  if (input.returnLastFrame) {
    body.return_last_frame = true;
  }

  const res = await fetch(
    `${BASE_URL}/contents/generations/tasks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("[seedance] create task failed:", res.status, errText);
    console.error("[seedance] request model:", model, "content items:", input.contentItems.length);
    throw new Error(`Seedance 创建任务失败: ${res.status} - ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; model?: string };
  console.log("[seedance] task created:", data.id);
  return {
    id: data.id,
    model: data.model ?? model,
    requestedModel: model,
  };
}

export interface TaskStatusResponse {
  id: string;
  model: string;
  status: string;
  content?: {
    video_url?: string;
    /** v2.0.0：Seedance return_last_frame=true 时返回的尾帧 URL（字段名最终确认前保留多种兼容） */
    last_frame_url?: string;
    last_frame?: { url?: string };
    image_url?: string;
    images?: Array<{ url?: string }>;
  };
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  error?: {
    code?: string;
    message?: string;
  };
  /** v2.0.0：保留原始 JSON 响应，供 Worker 容错解析尾帧 URL（PRD 第 11 条） */
  raw?: unknown;
}

export async function getTaskStatus(
  taskId: string,
  apiKey?: string
): Promise<TaskStatusResponse> {
  const resolvedKey = apiKey
    || await getGlobalConfig("seedance_api_key")
    || process.env.SEEDANCE_API_KEY;

  if (!resolvedKey) {
    throw new Error("SEEDANCE_API_KEY 未配置");
  }

  const res = await fetch(
    `${BASE_URL}/contents/generations/tasks/${taskId}`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedKey}`,
      },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("[seedance] get task status failed:", res.status, errText);
    throw new Error(`Seedance 查询任务失败: ${res.status}`);
  }

  const raw = await res.json();
  // 把原始 JSON 同时挂在 raw 字段上，Worker 用于兼容解析尾帧 URL
  return { ...raw, raw } as TaskStatusResponse;
}

/**
 * v2.0.0：从 Seedance 任务原始响应中兼容解析尾帧 URL。
 * 字段名最终待 P1-B 阶段用真实任务验证；本函数尽量覆盖常见命名。
 * 找不到时返回 null，Worker 端会走 ffmpeg 抽帧兜底。
 */
export function extractLastFrameUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const content = r.content as Record<string, unknown> | undefined;
  if (!content) return null;
  if (typeof content.last_frame_url === "string") return content.last_frame_url;
  const lf = content.last_frame as Record<string, unknown> | undefined;
  if (lf && typeof lf.url === "string") return lf.url;
  if (typeof content.image_url === "string") return content.image_url;
  const imgs = content.images as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[imgs.length - 1]?.url === "string") {
    return imgs[imgs.length - 1].url as string;
  }
  return null;
}
