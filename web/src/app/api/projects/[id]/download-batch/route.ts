import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import archiver from "archiver";
import { PassThrough, Readable } from "stream";

export const runtime = "nodejs";

const rawVideoDir = process.env.VIDEO_STORAGE_PATH || "./data/videos";
const VIDEO_DIR = path.resolve(rawVideoDir);

/** HTTP Content-Disposition 的 filename= 只能是 Latin1/ASCII，否则 Web Response 会抛 ByteString 错误 */
function contentDispositionAttachment(utf8Filename: string, asciiFallback: string): string {
  const safeAscii =
    asciiFallback
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 200) || "download.zip";
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`;
}

type ZipSource =
  | { kind: "file"; localPath: string; zipName: string }
  | { kind: "remote"; url: string; zipName: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true, name: true },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const storyboardIds: string[] | undefined = body.storyboardIds;

  const storyboardFilter: Record<string, unknown> = { projectId };
  if (Array.isArray(storyboardIds) && storyboardIds.length > 0) {
    storyboardFilter.id = { in: storyboardIds };
  }

  const storyboards = await prisma.storyboard.findMany({
    where: storyboardFilter,
    select: {
      id: true,
      storyboardId: true,
      tasks: {
        where: { status: { in: ["SUCCEEDED", "PERSISTED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          arkTaskId: true,
          localVideoPath: true,
          videoUrl: true,
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const sources: ZipSource[] = [];

  for (const sb of storyboards) {
    const task = sb.tasks[0];
    if (!task) continue;

    const zipName = `${sb.storyboardId}_${task.arkTaskId}.mp4`;
    const candidates = [
      task.localVideoPath,
      path.join(VIDEO_DIR, `${sb.storyboardId}_${task.arkTaskId}.mp4`),
      path.join(VIDEO_DIR, `${task.arkTaskId}.mp4`),
    ].filter(Boolean) as string[];

    const localPath = candidates.find((p) => fs.existsSync(p));
    if (localPath) {
      sources.push({ kind: "file", localPath, zipName });
    } else if (task.videoUrl) {
      sources.push({ kind: "remote", url: task.videoUrl, zipName });
    }
  }

  if (sources.length === 0) {
    return NextResponse.json(
      {
        error:
          "没有可下载的视频：本地未找到文件，且任务无可用远程视频地址（请确认 worker 已持久化或 Seedance 链接仍有效）",
      },
      { status: 400 }
    );
  }

  const archive = archiver("zip", { zlib: { level: 1 } });
  archive.on("warning", (err) => {
    console.warn("[download-batch] archiver warning:", err.message);
  });
  archive.on("error", (err) => {
    console.error("[download-batch] archiver error:", err);
  });

  for (const src of sources) {
    if (src.kind === "file") {
      archive.file(src.localPath, { name: src.zipName });
    } else {
      try {
        const res = await fetch(src.url, { redirect: "follow" });
        if (!res.ok || !res.body) {
          console.error(
            `[download-batch] remote fetch failed name=${src.zipName} status=${res.status}`
          );
          return NextResponse.json(
            {
              error: `无法拉取远程视频（${src.zipName}），HTTP ${res.status}。请稍后重试或确认视频已下载到本地。`,
            },
            { status: 502 }
          );
        }
        const nodeReadable = Readable.fromWeb(
          res.body as import("stream/web").ReadableStream<Uint8Array>
        );
        archive.append(nodeReadable, { name: src.zipName });
      } catch (fetchErr) {
        console.error("[download-batch] remote fetch exception:", fetchErr);
        return NextResponse.json(
          {
            error: `拉取远程视频失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          },
          { status: 502 }
        );
      }
    }
  }

  const passthrough = new PassThrough();
  archive.pipe(passthrough);
  void archive.finalize().catch((err) => {
    console.error("[download-batch] finalize error:", err);
    passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  const readableStream = Readable.toWeb(passthrough) as ReadableStream;

  const safeName = project.name.replace(/[^\w\u4e00-\u9fff-]/g, "_");
  const zipFilenameUtf8 = `${safeName}_videos.zip`;
  const zipFilenameAscii = `${project.id.slice(0, 8)}_videos.zip`;

  return new Response(readableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionAttachment(
        zipFilenameUtf8,
        zipFilenameAscii
      ),
      "Transfer-Encoding": "chunked",
    },
  });
}
