import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const rawVideoDir = process.env.VIDEO_STORAGE_PATH || "./data/videos";
const VIDEO_DIR = path.resolve(rawVideoDir);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { taskId } = await params;

  const task = await prisma.generationTask.findUnique({
    where: { id: taskId },
    include: {
      storyboard: {
        select: {
          storyboardId: true,
          project: { select: { userId: true } },
        },
      },
    },
  });

  if (!task || task.storyboard.project.userId !== session.user.id) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }

  const downloadName = `${task.storyboard.storyboardId}_${task.arkTaskId}.mp4`;
  const legacyFilename = `${task.arkTaskId}.mp4`;
  const isDownload = req.nextUrl.searchParams.get("download") === "1";

  const candidates = [
    task.localVideoPath,
    path.join(VIDEO_DIR, downloadName),
    path.join(VIDEO_DIR, legacyFilename),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(stat.size),
          ...(isDownload
            ? { "Content-Disposition": `attachment; filename="${downloadName}"` }
            : {}),
        },
      });
    }
  }

  // Fallback: redirect to remote Seedance URL
  if (task.videoUrl) {
    return NextResponse.redirect(task.videoUrl);
  }

  return NextResponse.json({ error: "视频尚未就绪，请稍后刷新" }, { status: 404 });
}
