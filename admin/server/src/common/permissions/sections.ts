// admin 端权限分栏配置（后端版本）
// 与 admin/web/src/config/admin-sections.ts 必须保持 key 同步。

export const ADMIN_SECTION_KEYS = [
  "dashboard",
  "users",
  "projects",
  "canvasProjects",
  "canvasChannelStats",
  "tasks",
  "prompts",
  "tokenUsage",
  "userActionLogs",
  "auditLogs",
  "credentials",
  "defaults",
  "modelRegistry",
  "globalConfig",
  // v1.9.0：Series（项目）管理。
  "series",
] as const;

export type SectionKey = (typeof ADMIN_SECTION_KEYS)[number];

export type SectionAction = "read" | "write";

export type SectionPermission = { read: boolean; write: boolean };

export type PermissionMatrix = Partial<Record<SectionKey, SectionPermission>>;

// 默认权限模板：用于历史数据回填，以及前端「一键模板」预留
export const DEFAULT_ADMIN_PERMISSIONS: PermissionMatrix = {
  dashboard: { read: true, write: false },
  users: { read: true, write: true },
  projects: { read: true, write: true },
  canvasProjects: { read: true, write: true },
  canvasChannelStats: { read: true, write: false },
  tasks: { read: true, write: true },
  prompts: { read: true, write: true },
  tokenUsage: { read: true, write: false },
  userActionLogs: { read: true, write: false },
  auditLogs: { read: true, write: false },
  series: { read: true, write: true },
};

export const DEFAULT_OPERATOR_PERMISSIONS: PermissionMatrix = {
  dashboard: { read: true, write: false },
  users: { read: true, write: false },
  projects: { read: true, write: false },
  canvasProjects: { read: true, write: false },
  canvasChannelStats: { read: true, write: false },
  tasks: { read: true, write: false },
  prompts: { read: true, write: false },
  tokenUsage: { read: true, write: false },
  userActionLogs: { read: true, write: false },
  auditLogs: { read: true, write: false },
  series: { read: true, write: false },
};

// 规范化：write=true 必须 read=true；read=false 必须 write=false
// 同时丢弃未知 section key
export function normalizePermissions(input: unknown): PermissionMatrix {
  if (!input || typeof input !== "object") return {};
  const out: PermissionMatrix = {};
  const known = new Set<string>(ADMIN_SECTION_KEYS);
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(k)) continue;
    const p = v as { read?: unknown; write?: unknown } | null | undefined;
    const read = !!p?.read;
    const write = !!p?.write;
    if (write) {
      out[k as SectionKey] = { read: true, write: true };
    } else if (read) {
      out[k as SectionKey] = { read: true, write: false };
    }
    // 全 false 时直接省略，等同未授予
  }
  return out;
}
