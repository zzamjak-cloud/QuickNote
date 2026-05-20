import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import ffmpegCoreURL from "@ffmpeg/core?url";
import ffmpegWasmURL from "@ffmpeg/core/wasm?url";

const PRIMARY_PROFILE = {
  maxWidth: 1280,
  crf: 30,
  audioBitrate: "128k",
};

const FALLBACK_PROFILE = {
  maxWidth: 960,
  crf: 35,
  audioBitrate: "96k",
};

const GIF_VIDEO_PROFILE = {
  maxWidth: 1280,
  fps: 24,
  crf: 30,
};

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let compressionQueue: Promise<void> = Promise.resolve();

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv|avi|mkv|mpg|mpeg|3gp)$/i.test(file.name);
}

export function isGifFile(file: File): boolean {
  return file.type === "image/gif" || /\.gif$/i.test(file.name);
}

export async function prepareVideoFileForUpload(file: File): Promise<File> {
  if (!isVideoFile(file)) return file;
  return enqueueCompression(async () => {
    const first = await transcodeVideo(file, PRIMARY_PROFILE, "compressed");
    if (first.size < file.size) return first;
    return transcodeVideo(file, FALLBACK_PROFILE, "compressed-small");
  });
}

export async function prepareGifFileBlockForUpload(file: File): Promise<File> {
  if (!isGifFile(file)) return file;
  return enqueueCompression(() => transcodeGifToMp4(file));
}

async function enqueueCompression<T>(task: () => Promise<T>): Promise<T> {
  const run = compressionQueue.then(task, task);
  compressionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (!ffmpegLoadPromise) {
    const ffmpeg = new FFmpeg();
    ffmpegLoadPromise = ffmpeg
      .load({
        coreURL: ffmpegCoreURL,
        wasmURL: ffmpegWasmURL,
      })
      .then(() => {
        ffmpegInstance = ffmpeg;
        return ffmpeg;
      })
      .catch((error) => {
        ffmpegLoadPromise = null;
        throw error;
      });
  }
  return ffmpegLoadPromise;
}

async function transcodeGifToMp4(file: File): Promise<File> {
  const ffmpeg = await loadFfmpeg();
  const safeBase = safeBaseName(file.name);
  const inputName = `${crypto.randomUUID()}-${safeBase || "input"}.gif`;
  const outputName = `${safeBase || "animation"}-compressed.mp4`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec([
      "-i",
      inputName,
      "-vf",
      `fps=${GIF_VIDEO_PROFILE.fps},scale=min(${GIF_VIDEO_PROFILE.maxWidth}\\,iw):-2:flags=lanczos`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(GIF_VIDEO_PROFILE.crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputName,
    ]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }
    return new File([await readFfmpegFileAsArrayBuffer(ffmpeg, outputName)], outputName, { type: "video/mp4" });
  } finally {
    await cleanupFfmpegFile(ffmpeg, inputName);
    await cleanupFfmpegFile(ffmpeg, outputName);
  }
}

async function transcodeVideo(
  file: File,
  profile: { maxWidth: number; crf: number; audioBitrate: string },
  suffix: string,
): Promise<File> {
  const ffmpeg = await loadFfmpeg();
  const safeBase = safeBaseName(file.name);
  const inputName = `${crypto.randomUUID()}-${safeBase || "input"}`;
  const outputName = `${safeBase || "video"}-${suffix}.mp4`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec([
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      `scale=min(${profile.maxWidth}\\,iw):-2`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(profile.crf),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      profile.audioBitrate,
      "-movflags",
      "+faststart",
      outputName,
    ]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }
    return new File([await readFfmpegFileAsArrayBuffer(ffmpeg, outputName)], outputName, { type: "video/mp4" });
  } finally {
    await cleanupFfmpegFile(ffmpeg, inputName);
    await cleanupFfmpegFile(ffmpeg, outputName);
  }
}

async function readFfmpegFileAsArrayBuffer(ffmpeg: FFmpeg, path: string): Promise<ArrayBuffer> {
  const data = await ffmpeg.readFile(path);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

async function cleanupFfmpegFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // MEMFS 파일이 생성되기 전에 실패한 경우는 무시한다.
  }
}

function safeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9가-힣_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
