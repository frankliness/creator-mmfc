import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertEpisodeAccess, SeriesAccessError } from "@/lib/series-membership";
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
          projectId: true,
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }

  // v1.9.0: legacy 项目验作者；Series 项目验成员（OWNER/PRODUCER/VIEWER 均可读）
  try {
    await assertEpisodeAccess(session.user.id, task.storyboard.projectId, "read");
  } catch (err) {
    if (err instanceof SeriesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
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
