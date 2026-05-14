// 历史 AdminUser 权限回填脚本（PRD §15.2）
//
// 用法（在 admin/server 目录下）：
//   npm run db:backfill-permissions
//
// 行为：
// - SUPER_ADMIN：不动 permissions（始终 NULL，运行时绕过矩阵）
// - ADMIN：若 permissions 为 NULL，写入 DEFAULT_ADMIN_PERMISSIONS
// - OPERATOR：若 permissions 为 NULL，写入 DEFAULT_OPERATOR_PERMISSIONS
// - 已经手工配置过 permissions（非 NULL）的账号一律跳过，避免覆盖
//
// 幂等：可重复执行；仅回填 NULL 字段。

import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_OPERATOR_PERMISSIONS,
} from "../../server/src/common/permissions/sections.js";

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.adminUser.findMany({
    where: { permissions: { equals: null as unknown as object } },
    select: { id: true, username: true, role: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const admin of candidates) {
    if (admin.role === "SUPER_ADMIN") {
      skipped += 1;
      continue;
    }
    const perms =
      admin.role === "ADMIN" ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_OPERATOR_PERMISSIONS;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { permissions: perms },
    });
    console.log(`[backfill] ${admin.role.padEnd(11)} ${admin.username} -> default ${admin.role.toLowerCase()} matrix`);
    updated += 1;
  }

  console.log(`\n[backfill] done. updated=${updated} skipped=${skipped} total=${candidates.length}`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
