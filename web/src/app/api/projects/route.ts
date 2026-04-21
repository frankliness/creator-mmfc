import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logUserAction } from "@/lib/user-action-logger";
import { z } from "zod";

const ratioEnum = z.enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]);
const resolutionEnum = z.enum(["480p", "720p"]);

const createAutoSchema = z.object({
  creationMode: z.literal("AUTO"),
  name: z.string().min(1, "项目名称不能为空"),
  script: z.string().min(1, "剧本不能为空"),
  fullScript: z.string().default(""),
  assetsJson: z.any(),
  assetDescriptions: z.any(),
  style: z.string().min(1, "美术风格不能为空"),
  ratio: ratioEnum,
  resolution: resolutionEnum,
});

const createManualSchema = z.object({
  creationMode: z.literal("MANUAL"),
  name: z.string().min(1, "项目名称不能为空"),
  script: z.string().optional().default(""),
  fullScript: z.string().optional().default(""),
  assetsJson: z.any().optional(),
  assetDescriptions: z.any().optional(),
  style: z.string().optional().default("未指定"),
  ratio: ratioEnum.optional().default("9:16"),
  resolution: resolutionEnum.optional().default("720p"),
});

const createProjectSchema = z.discriminatedUnion("creationMode", [
  createAutoSchema,
  createManualSchema,
]);

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { storyboards: true } } },
  });

  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "参数错误", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const base = {
      userId: session.user.id,
      name: data.name,
      script: data.script,
      fullScript: data.fullScript,
      assetsJson: data.assetsJson ?? {},
      assetDescriptions: data.assetDescriptions ?? {},
      style: data.style,
      ratio: data.ratio,
      resolution: data.resolution,
      seedanceEndpoint: process.env.SEEDANCE_ENDPOINT || "",
      globalSeed: Math.floor(Math.random() * 2147483647),
      creationMode: data.creationMode,
    };

    const project = await prisma.project.create({
      data:
        data.creationMode === "MANUAL"
          ? {
              ...base,
              status: "REVIEW",
            }
          : base,
    });

    await logUserAction({
      userId: session.user.id,
      category: "project",
      action: "project.create",
      targetType: "Project",
      targetId: project.id,
      projectId: project.id,
      route: "/api/projects",
      metadata: {
        name: project.name,
        creationMode: project.creationMode,
        status: project.status,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    console.error("Create project error:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
