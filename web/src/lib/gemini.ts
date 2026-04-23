import { DIRECTOR_SYSTEM_PROMPT } from "./prompts/director-system";
import { STORYBOARD_RESPONSE_SCHEMA } from "./prompts/storyboard-schema";
import { getPrompt, getJsonSchemaPrompt } from "./prompt-loader";
import { getGlobalConfig } from "./global-config";

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

export async function generateStoryboards(input: GeminiRequest): Promise<GenerateStoryboardsResult> {
  const apiKey = await getGlobalConfig("gemini_api_key") || process.env.GEMINI_API_KEY;
  const model = await getGlobalConfig("gemini_model") || process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 未配置");
  }

  const systemPrompt = await getPrompt("director_system", DIRECTOR_SYSTEM_PROMPT);
  const responseSchema = await getJsonSchemaPrompt("storyboard_schema", STORYBOARD_RESPONSE_SCHEMA);
  const userPromptTemplate = await getPrompt("user_prompt_template", userPrompt);
  const finalUserPrompt = renderUserPromptTemplate(userPromptTemplate, input);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        role: "system",
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: finalUserPrompt }],
        },
      ],
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
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini 返回内容为空");
  }

  const usageMetadata: GeminiUsageMetadata = result.usageMetadata ?? {};

  const parsed = JSON.parse(text);
  return {
    storyboards: parsed.storyboards as StoryboardResult[],
    usage: usageMetadata,
    model,
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
