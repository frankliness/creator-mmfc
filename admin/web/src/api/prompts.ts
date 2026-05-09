import request from "./request";

export const getPrompts = () => request.get("/prompts");
export const getPrompt = (id: string) => request.get(`/prompts/${id}`);
export const createPrompt = (data: Record<string, unknown>) => request.post("/prompts", data);
export const updatePrompt = (id: string, data: Record<string, unknown>) =>
  request.patch(`/prompts/${id}`, data);
export const publishPrompt = (id: string) => request.post(`/prompts/${id}/publish`);
export const rollbackPrompt = (id: string, version: number) =>
  request.post(`/prompts/${id}/rollback/${version}`);
export const getPromptVersions = (id: string) => request.get(`/prompts/${id}/versions`);

export interface SchemaTestResult {
  ok: boolean;
  latencyMs: number;
  providerUsed: string;
  modelUsed: string;
  responseText?: string | null;
  parsedOutput?: unknown;
  schemaValid?: boolean;
  error?: string;
}

export const testSchema = (
  schema: unknown,
  purpose: "storyboard",
  sampleScript?: string
): Promise<SchemaTestResult> =>
  request.post("/prompts/test-schema", { schema, purpose, sampleScript });
