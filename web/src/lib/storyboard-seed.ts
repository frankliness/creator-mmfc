export const MAX_STORYBOARD_SEED = 2147483647;

function isUsableSeed(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_STORYBOARD_SEED
  );
}

export function randomStoryboardSeed() {
  return Math.floor(Math.random() * MAX_STORYBOARD_SEED) + 1;
}

export function resolveStoryboardSeed(
  storyboardSeed: number | null | undefined,
  projectSeed: number | null | undefined
) {
  if (isUsableSeed(storyboardSeed)) return storyboardSeed;
  if (isUsableSeed(projectSeed)) return projectSeed;
  return randomStoryboardSeed();
}
