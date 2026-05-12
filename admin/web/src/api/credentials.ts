import request from "./request";

export type ProviderType = "openai" | "azure_openai" | "google" | "custom";
export type CredentialPurpose = "chat" | "storyboard" | "canvas_image" | "canvas_image_edit";

export interface Credential {
  id: string;
  provider: ProviderType;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  deployment: string | null;
  apiVersion: string | null;
  isActive: boolean;
  purposes: CredentialPurpose[];
  modelKeys: string[];
  isPrimary: boolean;
  sortOrder: number;
  remark: string | null;
  /** v1.5.0: 该渠道画布生图并发上限 */
  concurrency: number;
  /** v1.5.0: 限流冷却到期时间；过期或 null 表示可用 */
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialInput {
  provider?: ProviderType;
  name?: string;
  baseUrl?: string;
  apiKey?: string; // 创建时必填；更新时留空 = 不修改
  deployment?: string | null;
  apiVersion?: string | null;
  isActive?: boolean;
  purposes?: CredentialPurpose[];
  modelKeys?: string[] | null;
  isPrimary?: boolean;
  sortOrder?: number;
  remark?: string | null;
  concurrency?: number;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  provider: string;
  modelsCount?: number;
}

export const listCredentials = (provider?: ProviderType): Promise<Credential[]> =>
  request.get("/credentials", { params: provider ? { provider } : {} });

export const getCredential = (id: string): Promise<Credential> =>
  request.get(`/credentials/${id}`);

export const createCredential = (data: CredentialInput): Promise<Credential> =>
  request.post("/credentials", data);

export const updateCredential = (id: string, data: CredentialInput): Promise<Credential> =>
  request.patch(`/credentials/${id}`, data);

export const toggleCredential = (id: string): Promise<Credential> =>
  request.patch(`/credentials/${id}/toggle`);

export const setPrimaryCredential = (id: string): Promise<Credential> =>
  request.patch(`/credentials/${id}/set-primary`);

export const deleteCredential = (id: string) =>
  request.delete(`/credentials/${id}`);

export const testCredential = (id: string): Promise<ProbeResult> =>
  request.post(`/credentials/${id}/test`);
