import { prisma } from "./prisma";
import { decrypt } from "./crypto";

const configCache = new Map<string, { value: string; expireAt: number }>();
const CACHE_TTL = 60_000; // 1 minute

export async function getGlobalConfig(key: string): Promise<string | null> {
  const cached = configCache.get(key);
  if (cached && cached.expireAt > Date.now()) return cached.value;

  try {
    const config = await prisma.globalConfig.findUnique({ where: { key } });
    if (!config || !config.value) return null;

    let value: string;
    if (config.encrypted) {
      try { value = decrypt(config.value); } catch { return null; }
    } else {
      value = config.value;
    }
    configCache.set(key, { value, expireAt: Date.now() + CACHE_TTL });
    return value;
  } catch (err) {
    console.error(`[global-config] Failed to read ${key}:`, err);
    return null;
  }
}
