import request from "./request";

export type Purpose = "chat" | "storyboard" | "canvas_image" | "canvas_image_edit";

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  provider: string;
  modelsCount?: number;
}

export const testConnection = (purpose: Purpose): Promise<TestResult> =>
  request.post("/connection-test", { purpose });
