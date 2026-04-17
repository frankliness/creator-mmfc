import { PrismaClient } from "@prisma/client";

/** Next sequential id: s001, s002, … (ignores s001_1 style ids) */
export async function nextSequentialStoryboardId(
  prisma: PrismaClient,
  projectId: string
): Promise<string> {
  const rows = await prisma.storyboard.findMany({
    where: { projectId },
    select: { storyboardId: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = r.storyboardId.match(/^s(\d{3})$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `s${String(max + 1).padStart(3, "0")}`;
}
