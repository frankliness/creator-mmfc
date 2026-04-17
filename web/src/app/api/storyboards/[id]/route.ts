import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  prompt: z.string().optional(),
  duration: z.number().int().min(10).max(15).optional(),
  assetBindings: z.any().optional(),
  seedanceContentItems: z.any().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id },
    include: { project: { select: { userId: true } } },
  });

  if (!storyboard || storyboard.project.userId !== session.user.id) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.prompt !== undefined) data.prompt = parsed.data.prompt;
  if (parsed.data.duration !== undefined) data.duration = parsed.data.duration;
  if (parsed.data.assetBindings !== undefined)
    data.assetBindings = parsed.data.assetBindings;
  if (parsed.data.seedanceContentItems !== undefined)
    data.seedanceContentItems = parsed.data.seedanceContentItems;

  const updated = await prisma.storyboard.update({ where: { id }, data });
  return NextResponse.json(updated);
}
