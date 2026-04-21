import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authError, requireCanvasUser } from "@/lib/canvas/canvas-auth";
import { logUserAction } from "@/lib/user-action-logger";

const createSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function GET() {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const list = await prisma.canvasProject.findMany({
    where: { userId: auth.user.id, status: { not: "DELETED" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      thumbnail: true,
      viewport: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const auth = await requireCanvasUser();
  if (!auth.ok) return authError(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const created = await prisma.canvasProject.create({
    data: {
      userId: auth.user.id,
      name: parsed.data.name,
    },
    select: {
      id: true,
      name: true,
      viewport: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logUserAction({
    userId: auth.user.id,
    category: "canvas_project",
    action: "canvas_project.create",
    targetType: "CanvasProject",
    targetId: created.id,
    projectId: created.id,
    route: "/api/canvas/projects",
    metadata: {
      name: created.name,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
