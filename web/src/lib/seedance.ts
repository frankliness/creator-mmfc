import { getGlobalConfig } from "./global-config";

const BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

interface CreateTaskInput {
  prompt: string;
  contentItems: object[];
  duration: number;
  ratio: string;
  resolution: string;
  seed?: number;
}

interface CreateTaskResponse {
  id: string;
  model: string;
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

  const data = await res.json();
  console.log("[seedance] task created:", data.id);
  return data;
}

export interface TaskStatusResponse {
  id: string;
  model: string;
  status: string;
  content?: {
    video_url?: string;
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

  return res.json();
}
