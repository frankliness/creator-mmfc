import { prisma } from "./prisma";

const promptCache = new Map<string, { content: string; expireAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** 与 prisma/seed.ts 占位文案一致；避免 DB 仍为占位时覆盖代码内真实 fallback */
function isUnusableDbPrompt(content: string | null | undefined): boolean {
  if (content == null || !content.trim()) return true;
  return content.includes("[待从代码库导入]");
}

interface GetPromptOptions {
  /** 当前调用的 provider 类型（openai/azure_openai/google/custom）。
   *  传入后，会在多个同 slug 的模板里优先选 applicableProviders 包含该 provider 的；
   *  没有 provider-specific 匹配时退回到通用条目（applicableProviders 为 null/空数组）。 */
  provider?: string;
}

function pickTemplate<T extends { applicableProviders: unknown }>(
  candidates: T[],
  provider?: string
): T | null {
  if (candidates.length === 0) return null;

  if (provider) {
    const specific = candidates.find((t) => {
      const list = t.applicableProviders;
      return Array.isArray(list) && list.length > 0 && (list as string[]).includes(provider);
    });
    if (specific) return specific;
  }

  const generic = candidates.find((t) => {
    const list = t.applicableProviders;
    return list === null || list === undefined || (Array.isArray(list) && list.length === 0);
  });
  if (generic) return generic;

  return candidates[0];
}

export async function getPrompt(
  slug: string,
  fallback: string,
  options: GetPromptOptions = {}
): Promise<string> {
  const cacheKey = `${slug}::${options.provider ?? "*"}`;
  const cached = promptCache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) return cached.content;

  try {
    const candidates = await prisma.promptTemplate.findMany({
      where: { slug, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    const picked = pickTemplate(candidates, options.provider);
    const content =
      picked?.content && !isUnusableDbPrompt(picked.content) ? picked.content : fallback;

    promptCache.set(cacheKey, { content, expireAt: Date.now() + CACHE_TTL });
    return content;
  } catch {
    return fallback;
  }
}

export async function getJsonSchemaPrompt(
  slug: string,
  fallback: object,
  options: GetPromptOptions = {}
): Promise<object> {
  const content = await getPrompt(slug, JSON.stringify(fallback), options);
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}
