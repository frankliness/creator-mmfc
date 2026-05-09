import { DIRECTOR_SYSTEM_PROMPT } from "./prompts/director-system";
import { STORYBOARD_RESPONSE_SCHEMA } from "./prompts/storyboard-schema";
import { getPrompt, getJsonSchemaPrompt } from "./prompt-loader";
import { resolveStoryboardConfig } from "./llm/config-resolver";
import { resolveStoryboardByModel } from "./llm/credential-resolver";
import { getGlobalConfig } from "./global-config";
import { buildChatEndpoint } from "./llm/chat";
import type { ProviderConfig } from "./llm/types";

interface GeminiRequest {
  script: string;
  assets: string;
  fullScript: string;
  assetDescriptions: string;
  style: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface GenerateStoryboardsResult {
  storyboards: StoryboardResult[];
  usage: GeminiUsageMetadata;
  model: string;
}

/** Gemini 可能返回多个 parts（thinking 模型 + includeThoughts，或 JSON 落在后续 part）。 */
function extractGeminiCandidateJsonText(result: {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}): string | undefined {
  const candidate = result.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  if (parts.length === 0) return undefined;

  const hasThoughtFlagged = parts.some((p) => p.thought === true);
  const usable = hasThoughtFlagged ? parts.filter((p) => p.thought !== true) : parts;

  const chunks = usable
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter((t) => t.length > 0);
  if (chunks.length === 0) return undefined;

  const joined = chunks.join("");
  const trimmed = joined.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const userPrompt = `你将为一个 Seedance 2.0 视频生成工作流生成结构化分镜数据。

输入信息如下：

严格按照以下剧集内容执行/设计分镜【剧本 / 需求】
\${input.script}

【资产列表】
\${input.assets}

本剧集【完整剧本】便于理解全局世界观和剧情，不做为本次分镜的内容依据
\${input.fullScript}

本剧集出现的人物/场景描述，一切关于人物和场景的描述，都按照下面的设定
\${input.assetDescriptions}

【美术/视觉风格】
\${input.style}

请根据以下规则工作：

1. 如果用户已经明确写了分镜、镜号、镜头顺序、镜头内容、时长，你必须严格按用户设计输出，不得重排，不得补改剧情。
2. 如果用户没有明确写分镜，则你必须根据剧情、短剧节奏、Seedance 2.0 提示词规范自行拆分分镜。
3. 每个分镜都必须输出：
   - storyboard_id
   - duration（只允许 10、11、12、13、14、15 这 6 个整数；若用户明确指定某镜时长，则优先用户，但仍必须是整数）
   - prompt（单分镜完整 Seedance 提示词）
   - asset_bindings（该分镜实际用到的资产绑定，按提示词中首次出现顺序）
   - seedance_content_items（可直接插入 Seedance content 数组的 reference_image objects，顺序与 asset_bindings 完全一致）
4. 提示词中的资产引用必须先在开头完成绑定，例如：
   图1为豪宅，图2为爷爷，图3为姑妈……
5. 后续每次主体或场景再次出现时，必须重复带上图号引用。
6. 每个分镜只能挑选本镜真正需要的资产，不要把整集所有资产都塞进去。
7. asset_bindings 和 seedance_content_items 的顺序，必须严格按照该分镜 prompt 中这些资产第一次出现的顺序排列。
8. 资产输入里可能是 asset://asset-xxxx 或 asset-xxxx，都要正确处理。
9. 只输出符合 schema 的 JSON，不要输出解释。

补充要求：
- 分镜 prompt 必须是给 Seedance 2.0 的单分镜成片提示词，不是分析说明。
- 若为连续分镜，必须精确承接上一镜结尾的人物站位、空间调度、动作惯性、视线方向、道具位置和情绪状态。
- 不允许只写"承接上一镜，同一场景继续"这种空话。
- 长台词必须拆分，插入反应镜头、手部微动作、关键道具或空间关系镜头。
- 尾镜必须根据情况承担动作桥梁、转场引导或悬念钩子功能。
- 画面默认干净无字幕、无Logo、无水印、无UI；若用户另有要求，以用户要求为准。`;

function renderUserPromptTemplate(template: string, input: GeminiRequest): string {
  const replacements: Record<string, string> = {
    "${input.script}": input.script,
    "${input.assets}": input.assets,
    "${input.fullScript}": input.fullScript,
    "${input.assetDescriptions}": input.assetDescriptions,
    "${input.style}": input.style,
  };

  let rendered = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(value);
  }

  return rendered;
}

/**
 * 把 Gemini 风格的 schema（type: "OBJECT" / "ARRAY" 等大写）转换为标准 JSON Schema（小写），
 * 让 OpenAI 兼容 provider 的 response_format.json_schema 能直接用。
 */
function convertGeminiSchemaToOpenAI(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertGeminiSchemaToOpenAI);
  if (!node || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (typeof out.type === "string") {
    out.type = out.type.toLowerCase();
  }
  if (out.properties && typeof out.properties === "object") {
    const props = out.properties as Record<string, unknown>;
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, convertGeminiSchemaToOpenAI(v)])
    );
  }
  if (out.items) {
    out.items = convertGeminiSchemaToOpenAI(out.items);
  }
  // Gemini 的 propertyOrdering 在 OpenAI 这边非标，删掉
  delete out.propertyOrdering;
  return out;
}

export async function generateStoryboards(
  input: GeminiRequest,
  options: { userId?: string } = {}
): Promise<GenerateStoryboardsResult> {
  // v1.3.0：优先用 ProviderCredential 池解析（前提：admin 在「默认模型」页配了 storyboard_default_model_key）
  // 否则回退到 v1.2.0 的 GlobalConfig.${purpose}_* 路径
  const defaultModelKey = await getGlobalConfig("storyboard_default_model_key");
  const config = defaultModelKey
    ? await resolveStoryboardByModel(defaultModelKey, { userId: options.userId })
    : await resolveStoryboardConfig(options.userId);

  // 加载 prompts 时透传 provider，让 admin 在 prompt 管理里
  // 给特定 provider 单独配置 schema/system prompt（applicableProviders=["openai"] 等）
  const ctx = { provider: config.provider };

  const systemPrompt = await getPrompt("director_system", DIRECTOR_SYSTEM_PROMPT, ctx);
  const responseSchema = await getJsonSchemaPrompt(
    "storyboard_schema",
    STORYBOARD_RESPONSE_SCHEMA,
    ctx
  );
  const userPromptTemplate = await getPrompt("user_prompt_template", userPrompt, ctx);
  const finalUserPrompt = renderUserPromptTemplate(userPromptTemplate, input);

  if (config.provider === "google") {
    return generateStoryboardsGemini(config, { systemPrompt, responseSchema, finalUserPrompt });
  }
  return generateStoryboardsOpenAI(config, { systemPrompt, responseSchema, finalUserPrompt });
}

interface StoryboardCallInput {
  systemPrompt: string;
  responseSchema: unknown;
  finalUserPrompt: string;
}

async function generateStoryboardsGemini(
  config: ProviderConfig,
  { systemPrompt, responseSchema, finalUserPrompt }: StoryboardCallInput
): Promise<GenerateStoryboardsResult> {
  const base = config.baseUrl.replace(/\/+$/, "").replace(/\/openai$/, "");
  const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: finalUserPrompt }] }],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 0.5,
        thinkingConfig: { thinkingBudget: 30000 },
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API error:", response.status, errText);
    throw new Error(`Gemini API 调用失败: ${response.status}`);
  }

  const result = await response.json();
  const text = extractGeminiCandidateJsonText(result);

  if (!text) {
    const c0 = result.candidates?.[0];
    const parts = c0?.content?.parts ?? [];
    const usage = result.usageMetadata ?? {};
    console.error("[gemini] empty response text", {
      finishReason: c0?.finishReason,
      candidateCount: result.candidates?.length ?? 0,
      partCount: parts.length,
      parts: parts.map((p: { text?: string; thought?: boolean }, i: number) => ({
        i,
        thought: p.thought,
        textLen: typeof p.text === "string" ? p.text.length : 0,
      })),
      promptFeedback: result.promptFeedback,
      usage,
    });
    const fr = c0?.finishReason ? ` finishReason=${c0.finishReason}` : "";
    const th = typeof usage.thoughtsTokenCount === "number" ? ` thoughtsTokenCount=${usage.thoughtsTokenCount}` : "";
    const ct = typeof usage.candidatesTokenCount === "number" ? ` candidatesTokenCount=${usage.candidatesTokenCount}` : "";
    throw new Error(`Gemini 返回内容为空（多为输出预算被思考占满导致 MAX_TOKENS 且无可见 JSON）${fr}${th}${ct}`);
  }

  const usageMetadata: GeminiUsageMetadata = result.usageMetadata ?? {};
  const parsed = JSON.parse(text);
  return {
    storyboards: parsed.storyboards as StoryboardResult[],
    usage: usageMetadata,
    model: config.model,
  };
}

async function generateStoryboardsOpenAI(
  config: ProviderConfig,
  { systemPrompt, responseSchema, finalUserPrompt }: StoryboardCallInput
): Promise<GenerateStoryboardsResult> {
  const { url, headers } = buildChatEndpoint(config, config.model);
  const openaiSchema = convertGeminiSchemaToOpenAI(responseSchema);

  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: finalUserPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "storyboard_response",
        schema: openaiSchema,
      },
    },
    temperature: 0.5,
    max_tokens: 16384,
  };
  // Azure 用 deployment URL，body.model 字段冗余；其他 provider 必须传
  if (config.provider !== "azure_openai") body.model = config.model;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[storyboard][openai-compat] API error:", response.status, errText);
    throw new Error(`分镜模型调用失败 (${config.provider} ${response.status}): ${errText.slice(0, 300)}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const text = result.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error(
      `分镜模型未返回内容（finish_reason=${result.choices?.[0]?.finish_reason ?? "unknown"}）`
    );
  }

  let parsed: { storyboards?: StoryboardResult[] };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[storyboard][openai-compat] JSON parse failed:", text.slice(0, 500));
    throw new Error(`分镜模型返回非 JSON 内容（解析失败）`);
  }
  if (!parsed.storyboards || !Array.isArray(parsed.storyboards)) {
    throw new Error("分镜模型返回数据缺少 storyboards 数组");
  }

  // 把 OpenAI usage 字段映射到 GeminiUsageMetadata 的形态，调用方代码无需改
  const usageMetadata: GeminiUsageMetadata = {
    promptTokenCount: result.usage?.prompt_tokens,
    candidatesTokenCount: result.usage?.completion_tokens,
    totalTokenCount: result.usage?.total_tokens,
  };

  return {
    storyboards: parsed.storyboards,
    usage: usageMetadata,
    model: config.model,
  };
}

export interface StoryboardResult {
  storyboard_id: string;
  duration: number;
  prompt: string;
  asset_bindings: {
    index_label: string;
    asset_name: string;
    asset_uri: string;
  }[];
  seedance_content_items: {
    type: string;
    image_url: { url: string };
    role: string;
  }[];
}
