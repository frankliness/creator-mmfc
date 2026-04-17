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

  // 2. Seed initial Prompt Templates
  const prompts = [
    {
      slug: "director_system",
      name: "导演系统提示词",
      category: "SYSTEM_PROMPT" as const,
      description: "Gemini 生成分镜时使用的系统级提示词",
    },
    {
      slug: "storyboard_schema",
      name: "分镜输出 Schema",
      category: "JSON_SCHEMA" as const,
      description: "Gemini 生成分镜时的结构化输出约束 (responseSchema)",
    },
    {
      slug: "user_prompt_template",
      name: "用户提示词模板",
      category: "USER_PROMPT" as const,
      description: "拼装发给 Gemini 的用户侧提示词模板",
    },
  ];

  for (const p of prompts) {
    const existing = await prisma.promptTemplate.findUnique({ where: { slug: p.slug } });
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

  console.log("[seed] Done.");
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
