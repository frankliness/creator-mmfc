import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 1. Seed initial SUPER_ADMIN
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { username: "admin" },
  });

  if (!existingAdmin) {
    const passwordHash = await hash("admin123456", 12);
    await prisma.adminUser.create({
      data: {
        username: "admin",
        passwordHash,
        displayName: "超级管理员",
        role: "SUPER_ADMIN",
      },
    });
    console.log("[seed] Created default admin: admin / admin123456");
  }

  // 2. Seed initial Prompt Templates（slug 不再唯一，但 seed 占位条目仅创建一条通用版）
  const prompts = [
    {
      slug: "director_system",
      name: "导演系统提示词",
      category: "SYSTEM_PROMPT" as const,
      description: "分镜生成时使用的系统级提示词（适用所有 provider；如需特定 provider 单独定制，请新建条目并设 applicableProviders）",
    },
    {
      slug: "storyboard_schema",
      name: "分镜输出 Schema（通用 / Gemini 风格）",
      category: "JSON_SCHEMA" as const,
      description: "分镜结构化输出 schema。Gemini 路径直接用；非 Gemini 路径默认会自动转换为 OpenAI structured output 格式。如需为 OpenAI/Azure 单独定制，请新建一条同 slug 的条目并设 applicableProviders=['openai','azure_openai']",
    },
    {
      slug: "user_prompt_template",
      name: "用户提示词模板",
      category: "USER_PROMPT" as const,
      description: "拼装发给分镜模型的用户侧提示词模板",
    },
  ];

  for (const p of prompts) {
    // 已有任何同 slug 条目就跳过，避免重复 seed
    const existing = await prisma.promptTemplate.findFirst({
      where: { slug: p.slug },
    });
    if (!existing) {
      await prisma.promptTemplate.create({
        data: {
          ...p,
          content: `[待从代码库导入] ${p.name}`,
          version: 1,
          versions: {
            create: {
              version: 1,
              content: `[待从代码库导入] ${p.name}`,
              changeNote: "初始占位，请从代码库导入实际内容",
            },
          },
        },
      });
      console.log(`[seed] Created prompt template: ${p.slug}`);
    }
  }

  // 3. Seed GlobalConfig defaults
  const defaultConfigs = [
    { key: "seedance_api_key", encrypted: true, remark: "Seedance 全局 API Key" },
    { key: "seedance_endpoint", encrypted: false, remark: "Seedance 全局 Endpoint" },
    { key: "seedance_model", encrypted: false, remark: "Seedance 默认模型" },
    { key: "gemini_api_key", encrypted: true, remark: "Gemini 全局 API Key" },
    { key: "gemini_model", encrypted: false, remark: "Gemini 默认模型" },
  ];

  for (const c of defaultConfigs) {
    const existing = await prisma.globalConfig.findUnique({ where: { key: c.key } });
    if (!existing) {
      await prisma.globalConfig.create({
        data: { key: c.key, value: "", encrypted: c.encrypted, remark: c.remark },
      });
      console.log(`[seed] Created global config: ${c.key}`);
    }
  }

  // 4. Seed ModelRegistry: 所有候选模型注册进 DB；只激活几个最常用的，admin 后续手动开启其他
  await seedModelRegistry();

  // 5. v1.3.0：把现存的 ${purpose}_* GlobalConfig 凭据回填进 ProviderCredential（只在表为空时跑一次）
  await backfillProviderCredentials();

  console.log("[seed] Done.");
}

interface ModelSeed {
  modelKey: string;
  label: string;
  category: "chat" | "canvas_image" | "canvas_image_edit" | "storyboard";
  providers: string[];
  capabilities: Record<string, boolean>;
  sizes?: string[] | null;
  qualities?: Array<{ label: string; key: string }> | null;
  defaultParams?: Record<string, string> | null;
  tips?: string;
  isActive: boolean;
  sortOrder: number;
}

async function seedModelRegistry() {
  const BANANA_SIZES = ["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"];
  const GOOGLE_QUALITIES = [
    { label: "1K", key: "1K" },
    { label: "2K", key: "2K" },
    { label: "4K", key: "4K" },
  ];
  const DALLE_SIZES = ["1:1", "16:9", "9:16"];
  const DALLE_QUALITIES = [
    { label: "Standard", key: "standard" },
    { label: "HD", key: "hd" },
  ];
  const GPT_IMAGE_SIZES = ["1:1", "16:9", "9:16"];
  const GPT_IMAGE_QUALITIES = [
    { label: "Low", key: "low" },
    { label: "Medium", key: "medium" },
    { label: "High", key: "high" },
    { label: "Auto", key: "auto" },
  ];

  const seeds: ModelSeed[] = [
    // ── Chat：默认激活 gpt-4o + gemini-3-flash-preview ──
    {
      modelKey: "gpt-4o", label: "GPT-4o", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: true, streaming: true },
      isActive: true, sortOrder: 10,
    },
    {
      modelKey: "gpt-4o-mini", label: "GPT-4o Mini", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: true, streaming: true },
      isActive: false, sortOrder: 20,
    },
    {
      modelKey: "gpt-4.1", label: "GPT-4.1", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: true, streaming: true },
      isActive: false, sortOrder: 30,
    },
    {
      modelKey: "gpt-4.1-mini", label: "GPT-4.1 Mini", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: true, streaming: true },
      isActive: false, sortOrder: 40,
    },
    {
      modelKey: "o1", label: "o1", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: true, tools: false, jsonSchema: true, jsonMode: true, streaming: false },
      isActive: false, sortOrder: 50,
    },
    {
      modelKey: "o3-mini", label: "o3 Mini", category: "chat",
      providers: ["openai", "azure_openai"],
      capabilities: { vision: false, tools: true, jsonSchema: true, jsonMode: true, streaming: true },
      isActive: false, sortOrder: 60,
    },
    {
      modelKey: "gemini-3-flash-preview", label: "Gemini 3 Flash", category: "chat",
      providers: ["google"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: false, streaming: true },
      isActive: true, sortOrder: 100,
    },
    {
      modelKey: "gemini-2.5-flash", label: "Gemini 2.5 Flash", category: "chat",
      providers: ["google"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: false, streaming: true },
      isActive: false, sortOrder: 110,
    },
    {
      modelKey: "gemini-3-pro-preview", label: "Gemini 3 Pro", category: "chat",
      providers: ["google"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: false, streaming: true },
      isActive: false, sortOrder: 120,
    },
    {
      modelKey: "gemini-2.5-pro", label: "Gemini 2.5 Pro", category: "chat",
      providers: ["google"],
      capabilities: { vision: true, tools: true, jsonSchema: true, jsonMode: false, streaming: true },
      isActive: false, sortOrder: 130,
    },
    // ── Storyboard：默认激活 gemini-3.1-pro-preview ──
    {
      modelKey: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (默认分镜)", category: "storyboard",
      providers: ["google"],
      capabilities: { jsonSchema: true, vision: false },
      isActive: true, sortOrder: 10,
    },
    {
      modelKey: "gpt-4o", label: "GPT-4o", category: "storyboard",
      providers: ["openai", "azure_openai"],
      capabilities: { jsonSchema: true, vision: false },
      isActive: false, sortOrder: 20,
      tips: "需要给 OpenAI 单独配 storyboard schema（applicableProviders=['openai','azure_openai']），或用自动转换",
    },
    // ── Canvas Image (text-to-image)：默认激活 gpt-image-1 + nano banana pro ──
    {
      modelKey: "gpt-image-1", label: "GPT Image 1", category: "canvas_image",
      providers: ["openai", "azure_openai"],
      capabilities: { imageGen: true, imageEdit: false },
      sizes: GPT_IMAGE_SIZES, qualities: GPT_IMAGE_QUALITIES,
      defaultParams: { size: "1:1", quality: "high" },
      tips: "OpenAI gpt-image-1，文生图。图生图需在 canvas_image_edit 里单独注册",
      isActive: true, sortOrder: 10,
    },
    {
      modelKey: "dall-e-3", label: "DALL-E 3", category: "canvas_image",
      providers: ["openai", "azure_openai"],
      capabilities: { imageGen: true, imageEdit: false },
      sizes: DALLE_SIZES, qualities: DALLE_QUALITIES,
      defaultParams: { size: "1:1", quality: "hd" },
      tips: "DALL-E 3，仅文生图，不支持图生图",
      isActive: false, sortOrder: 20,
    },
    {
      modelKey: "gemini-3-pro-image-preview", label: "Nano Banana Pro", category: "canvas_image",
      providers: ["google"],
      capabilities: { imageGen: true, imageEdit: true },
      sizes: BANANA_SIZES, qualities: GOOGLE_QUALITIES,
      defaultParams: { size: "1:1", quality: "2K" },
      isActive: true, sortOrder: 100,
    },
    {
      modelKey: "gemini-3.1-flash-image-preview", label: "Nano Banana 2", category: "canvas_image",
      providers: ["google"],
      capabilities: { imageGen: true, imageEdit: true },
      sizes: BANANA_SIZES, qualities: GOOGLE_QUALITIES,
      defaultParams: { size: "1:1", quality: "2K" },
      isActive: false, sortOrder: 110,
    },
    // ── Canvas Image Edit (image-to-image)：默认激活 gpt-image-1 + nano banana pro ──
    {
      modelKey: "gpt-image-1", label: "GPT Image 1 (Edit)", category: "canvas_image_edit",
      providers: ["openai", "azure_openai"],
      capabilities: { imageGen: false, imageEdit: true },
      sizes: GPT_IMAGE_SIZES, qualities: GPT_IMAGE_QUALITIES,
      defaultParams: { size: "1:1", quality: "high" },
      tips: "支持多张参考图 (image edit)，DALL-E 3 在此 category 不可用",
      isActive: true, sortOrder: 10,
    },
    {
      modelKey: "gemini-3-pro-image-preview", label: "Nano Banana Pro (Edit)", category: "canvas_image_edit",
      providers: ["google"],
      capabilities: { imageGen: false, imageEdit: true },
      sizes: BANANA_SIZES, qualities: GOOGLE_QUALITIES,
      defaultParams: { size: "1:1", quality: "2K" },
      isActive: true, sortOrder: 100,
    },
    {
      modelKey: "gemini-3.1-flash-image-preview", label: "Nano Banana 2 (Edit)", category: "canvas_image_edit",
      providers: ["google"],
      capabilities: { imageGen: false, imageEdit: true },
      sizes: BANANA_SIZES, qualities: GOOGLE_QUALITIES,
      defaultParams: { size: "1:1", quality: "2K" },
      isActive: false, sortOrder: 110,
    },
  ];

  for (const m of seeds) {
    const existing = await prisma.modelRegistry.findUnique({
      where: { modelKey_category: { modelKey: m.modelKey, category: m.category } },
    });
    if (!existing) {
      await prisma.modelRegistry.create({
        data: {
          modelKey: m.modelKey,
          label: m.label,
          category: m.category,
          providers: m.providers,
          capabilities: m.capabilities,
          sizes: m.sizes ?? undefined,
          qualities: m.qualities ?? undefined,
          defaultParams: m.defaultParams ?? undefined,
          tips: m.tips,
          isActive: m.isActive,
          sortOrder: m.sortOrder,
        },
      });
      console.log(
        `[seed] Created model: ${m.category}/${m.modelKey} (${m.isActive ? "active" : "inactive"})`
      );
    }
  }
}

/**
 * 把现有 ${purpose}_provider/${purpose}_base_url/${purpose}_api_key/... 6 元组合并去重
 * 写入 ProviderCredential 表；同 (provider, baseUrl) 去重，第一条标记 isPrimary=true。
 *
 * 仅在 ProviderCredential 表为空时运行（首次升级到 v1.3.0 的回填）。
 * 加密：旧 GlobalConfig.value 已是密文（encrypted=true），直接搬过来即可，无需重新加密。
 */
async function backfillProviderCredentials() {
  const existingCount = await prisma.providerCredential.count();
  if (existingCount > 0) {
    return; // 已经有数据，跳过回填
  }

  const PURPOSES = ["chat", "canvas_image", "canvas_image_edit", "storyboard"] as const;
  const dedupByCombo = new Set<string>(); // `${provider}__${baseUrl}`：去重相同 provider+baseUrl
  const primaryAssigned = new Set<string>(); // provider 名 → 已分配过 isPrimary

  for (const purpose of PURPOSES) {
    const [provider, baseUrl, apiKey, deployment, apiVersion] = await Promise.all([
      prisma.globalConfig.findUnique({ where: { key: `${purpose}_provider` } }),
      prisma.globalConfig.findUnique({ where: { key: `${purpose}_base_url` } }),
      prisma.globalConfig.findUnique({ where: { key: `${purpose}_api_key` } }),
      prisma.globalConfig.findUnique({ where: { key: `${purpose}_deployment` } }),
      prisma.globalConfig.findUnique({ where: { key: `${purpose}_api_version` } }),
    ]);

    if (!provider?.value || !baseUrl?.value || !apiKey?.value) continue;

    const combo = `${provider.value}__${baseUrl.value}`;
    if (dedupByCombo.has(combo)) continue;
    dedupByCombo.add(combo);

    const isPrimary = !primaryAssigned.has(provider.value);
    if (isPrimary) primaryAssigned.add(provider.value);

    const created = await prisma.providerCredential.create({
      data: {
        provider: provider.value,
        name: `${provider.value} (从 ${purpose} 迁移)`,
        baseUrl: baseUrl.value,
        apiKey: apiKey.value, // 已加密
        deployment: deployment?.value || null,
        apiVersion: apiVersion?.value || null,
        isActive: true,
        isPrimary,
        sortOrder: 100,
        remark: `从 v1.2.0 GlobalConfig.${purpose}_* 自动迁移`,
      },
    });
    console.log(
      `[seed] Backfilled ProviderCredential: ${provider.value} <- ${purpose} (id=${created.id}, primary=${isPrimary})`
    );
  }
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
