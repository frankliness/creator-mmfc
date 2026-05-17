// admin 端权限分栏配置（前端版本）
// 与 admin/server/src/common/permissions/sections.ts 必须保持 key 同步。

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
  // v1.9.0：Series（项目）管理
  "series",
] as const;

export type SectionKey = (typeof ADMIN_SECTION_KEYS)[number];

export type SectionAction = "read" | "write";

export type SectionPermission = { read: boolean; write: boolean };

export type PermissionMatrix = Partial<Record<SectionKey, SectionPermission>>;

export type SectionGroup = "main" | "system";

export interface SectionMeta {
  key: SectionKey;
  label: string;
  group: SectionGroup;
  routePath: string;        // 默认入口路由
  description: string;      // read 含义
  writeDescription?: string;// write 含义；缺省表示只读模块
  hasWrite: boolean;        // 是否存在写操作
  highRiskWrite?: boolean;  // 写权限是否高危
  note?: string;            // 额外提示（如 defaults 依赖 globalConfig.write）
}

export const ADMIN_SECTIONS: SectionMeta[] = [
  {
    key: "dashboard",
    label: "仪表盘",
    group: "main",
    routePath: "/dashboard",
    description: "查看核心指标、趋势、任务状态",
    hasWrite: false,
  },
  {
    key: "users",
    label: "用户管理",
    group: "main",
    routePath: "/users",
    description: "查看用户列表、用户详情",
    writeDescription: "修改用户状态、配额、备注、重置密码",
    hasWrite: true,
  },
  {
    key: "projects",
    label: "项目管理",
    group: "main",
    routePath: "/projects",
    description: "查看项目列表、项目详情",
    writeDescription: "删除项目",
    hasWrite: true,
  },
  {
    key: "series",
    label: "Series（项目集）",
    group: "main",
    routePath: "/series",
    description: "查看 Series 列表、成员、预算、集数、日志",
    writeDescription: "新增 Series、配置预算、分配成员、调整 buffer",
    hasWrite: true,
    highRiskWrite: true,
  },
  {
    key: "canvasProjects",
    label: "AI 画布项目",
    group: "main",
    routePath: "/canvas-projects",
    description: "查看画布项目列表、详情",
    writeDescription: "删除或修改画布项目状态",
    hasWrite: true,
  },
  {
    key: "canvasChannelStats",
    label: "画布渠道统计",
    group: "main",
    routePath: "/canvas-channel-stats",
    description: "查看渠道统计",
    hasWrite: false,
  },
  {
    key: "tasks",
    label: "任务管理",
    group: "main",
    routePath: "/tasks",
    description: "查看任务列表、详情、实时统计",
    writeDescription: "重试任务等写操作",
    hasWrite: true,
    highRiskWrite: true,
  },
  {
    key: "prompts",
    label: "Prompt 管理",
    group: "main",
    routePath: "/prompts",
    description: "查看 Prompt 列表、详情、版本历史",
    writeDescription: "新增、修改、发布、回滚、Schema 测试",
    hasWrite: true,
    highRiskWrite: true,
  },
  {
    key: "tokenUsage",
    label: "Token 统计",
    group: "main",
    routePath: "/token-usage",
    description: "查看 Token 汇总、明细、导出",
    hasWrite: false,
  },
  {
    key: "userActionLogs",
    label: "用户操作日志",
    group: "main",
    routePath: "/user-action-logs",
    description: "查看用户操作日志",
    hasWrite: false,
  },
  {
    key: "auditLogs",
    label: "审计日志",
    group: "main",
    routePath: "/audit-logs",
    description: "查看审计日志",
    hasWrite: false,
  },
  {
    key: "credentials",
    label: "凭据池",
    group: "system",
    routePath: "/system/credentials",
    description: "查看凭据池列表和详情",
    writeDescription: "新增、修改、删除、启停、设主用、连接测试",
    hasWrite: true,
    highRiskWrite: true,
  },
  {
    key: "defaults",
    label: "默认模型",
    group: "system",
    routePath: "/system/defaults",
    description: "查看默认模型配置",
    writeDescription: "修改默认模型配置",
    hasWrite: true,
    highRiskWrite: true,
    note: "保存默认模型会写入全局配置，需同时具备 globalConfig 写权限",
  },
  {
    key: "modelRegistry",
    label: "模型注册表",
    group: "system",
    routePath: "/system/model-registry",
    description: "查看模型列表和配置",
    writeDescription: "新增、修改、启停、删除模型配置",
    hasWrite: true,
    highRiskWrite: true,
  },
  {
    key: "globalConfig",
    label: "全局配置",
    group: "system",
    routePath: "/system/global-config",
    description: "查看全局配置",
    writeDescription: "修改全局配置",
    hasWrite: true,
    highRiskWrite: true,
  },
];

export const SECTION_BY_KEY: Record<SectionKey, SectionMeta> = ADMIN_SECTIONS.reduce(
  (acc, s) => {
    acc[s.key] = s;
    return acc;
  },
  {} as Record<SectionKey, SectionMeta>,
);

// 写联动规范化：与后端保持一致
export function normalizePermissions(input: unknown): PermissionMatrix {
  if (!input || typeof input !== "object") return {};
  const out: PermissionMatrix = {};
  const known = new Set<string>(ADMIN_SECTION_KEYS);
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(k)) continue;
    const p = v as { read?: unknown; write?: unknown } | null | undefined;
    const read = !!p?.read;
    const write = !!p?.write;
    if (write) out[k as SectionKey] = { read: true, write: true };
    else if (read) out[k as SectionKey] = { read: true, write: false };
  }
  return out;
}
