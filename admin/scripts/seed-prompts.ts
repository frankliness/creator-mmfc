/**
 * Seed actual prompt content from the user-side codebase into the DB.
 * Run after the initial placeholder seed has been executed.
 *
 * Usage: npx tsx scripts/seed-prompts.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

/** 本地：admin/scripts → ../../web/...；Docker：SEED_PROMPT_SOURCE_DIR=/app/seed-web/prompts */
const PROMPTS_DIR = process.env.SEED_PROMPT_SOURCE_DIR
  ? resolve(process.env.SEED_PROMPT_SOURCE_DIR)
  : resolve(__dirname, "../../web/src/lib/prompts");
const GEMINI_FILE = process.env.SEED_GEMINI_FILE
  ? resolve(process.env.SEED_GEMINI_FILE)
  : resolve(__dirname, "../../web/src/lib/gemini.ts");

async function main() {
  // 1. director_system.ts
  const directorFile = readFileSync(resolve(PROMPTS_DIR, "director-system.ts"), "utf-8");
  const directorMatch = directorFile.match(/export const DIRECTOR_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (directorMatch) {
    await upsertPrompt("director_system", directorMatch[1]);
    console.log("[seed-prompts] Updated director_system");
  }

  // 2. storyboard_schema.ts
  const schemaFile = readFileSync(resolve(PROMPTS_DIR, "storyboard-schema.ts"), "utf-8");
  const schemaMatch = schemaFile.match(/export const STORYBOARD_RESPONSE_SCHEMA = (\{[\s\S]*\});/);
  if (schemaMatch) {
    // The exported value is a JS object literal, evaluate it
    const schemaObj = eval(`(${schemaMatch[1]})`);
    await upsertPrompt("storyboard_schema", JSON.stringify(schemaObj, null, 2));
    console.log("[seed-prompts] Updated storyboard_schema");
  }

  // 3. user_prompt_template (from gemini.ts)
  const geminiFile = readFileSync(GEMINI_FILE, "utf-8");
  const promptMatch = geminiFile.match(/const userPrompt = `([\s\S]*?)`;/);
  if (promptMatch) {
    await upsertPrompt("user_prompt_template", promptMatch[1]);
    console.log("[seed-prompts] Updated user_prompt_template");
  }

  console.log("[seed-prompts] Done.");
}

async function upsertPrompt(slug: string, content: string) {
  const existing = await prisma.promptTemplate.findUnique({ where: { slug } });
  if (!existing) {
    console.error(`[seed-prompts] Template ${slug} not found, skipping`);
    return;
  }

  if (existing.content === content) {
    console.log(`[seed-prompts] ${slug} unchanged, skip`);
    return;
  }

  const newVersion = existing.version + 1;
  await prisma.promptTemplate.update({
    where: { slug },
    data: {
      content,
      version: newVersion,
    },
  });

  await prisma.promptVersion.create({
    data: {
      templateId: existing.id,
      version: newVersion,
      content,
      changeNote: "从代码库自动导入",
    },
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
