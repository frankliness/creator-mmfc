export const MANUAL_STORYBOARD_DURATION_OPTIONS = [
  -1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export const DEFAULT_MANUAL_STORYBOARD_DURATION = 5;

export const MANUAL_STORYBOARD_DURATION_HINT =
  "仅支持整数秒：4-15，或 -1（由模型自动选择 4-15 秒）";

export function isValidManualStoryboardDuration(value: number) {
  return Number.isInteger(value) && (value === -1 || (value >= 4 && value <= 15));
}

export function formatManualStoryboardDuration(value: number) {
  if (value === -1) {
    return "自动（-1）";
  }
  return `${value}s`;
}
