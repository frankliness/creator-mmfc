import { prisma } from "./prisma";

const promptCache = new Map<string, { content: string; expireAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** 与 prisma/seed.ts 占位文案一致；避免 DB 仍为占位时覆盖代码内真实 fallback */
function isUnusableDbPrompt(content: string | null | undefined): boolean {
  if (content == null || !content.trim()) return true;
  return content.includes("[待从代码库导入]");
}

export async function getPrompt(slug: string, fallback: string): Promise<string> {
  const cached = promptCache.get(slug);
  if (cached && cached.expireAt > Date.now()) return cached.content;

  try {
    const template = await prisma.promptTemplate.findFirst({
      where: { slug, isActive: true },
    });

    const content =
      template?.content && !isUnusableDbPrompt(template.content)
        ? template.content
        : fallback;
    promptCache.set(slug, { content, expireAt: Date.now() + CACHE_TTL });
    return content;
  } catch {
    return fallback;
  }
}

export async function getJsonSchemaPrompt(slug: string, fallback: object): Promise<object> {
  const content = await getPrompt(slug, JSON.stringify(fallback));
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}
