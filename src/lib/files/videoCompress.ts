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

// 진행 중인 작업을 강제 종료할 때 호출 — 타임아웃·취소 시 사용
export function terminateFfmpeg(): void {
  try {
    ffmpegInstance?.terminate();
    console.warn("[ffmpeg] terminate() 호출 — 인스턴스 폐기");
  } catch (err) {
    console.warn("[ffmpeg] terminate 실패", err);
  }
  ffmpegInstance = null;
  ffmpegLoadPromise = null;
}

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
    // 글로벌 진단 로그 — 한 번만 부착
    ffmpeg.on("log", ({ type, message }) => {
      // FFmpeg 로그가 너무 많을 수 있어서 에러/경고만 출력
      if (type === "stderr" && /error|invalid|fail/i.test(message)) {
        console.warn(`[ffmpeg log] ${message}`);
      }
    });
    const t0 = performance.now();
    console.log("[ffmpeg] load 시작");
    ffmpegLoadPromise = ffmpeg
      .load({
        coreURL: ffmpegCoreURL,
        wasmURL: ffmpegWasmURL,
      })
      .then(() => {
        console.log(`[ffmpeg] load 완료 — ${((performance.now() - t0) / 1000).toFixed(2)}초`);
        ffmpegInstance = ffmpeg;
        return ffmpeg;
      })
      .catch((error) => {
        console.error("[ffmpeg] load 실패", error);
        ffmpegLoadPromise = null;
        throw error;
      });
  }
  return ffmpegLoadPromise;
}

async function transcodeGifToMp4(file: File): Promise<File> {
  const tagLog = `[ffmpeg-gif "${file.name}" ${(file.size / 1024).toFixed(0)}KB]`;
  console.log(`${tagLog} 작업 시작`);
  const t0 = performance.now();
  const ffmpeg = await loadFfmpeg();
  console.log(`${tagLog} loadFfmpeg 완료 +${(performance.now() - t0).toFixed(0)}ms`);

  const safeBase = safeBaseName(file.name);
  const inputName = `${crypto.randomUUID()}-${safeBase || "input"}.gif`;
  const outputName = `${safeBase || "animation"}-compressed.mp4`;

  // 작업별 진행 콜백 — 끝나면 detach
  const onProgress = (ev: { progress: number; time: number }) => {
    console.log(`${tagLog} progress ${(ev.progress * 100).toFixed(0)}% (time ${ev.time}s)`);
  };
  ffmpeg.on("progress", onProgress);

  try {
    const tWrite = performance.now();
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    console.log(`${tagLog} writeFile 완료 +${(performance.now() - tWrite).toFixed(0)}ms`);

    const tExec = performance.now();
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
    console.log(`${tagLog} exec 완료 (code ${exitCode}) +${((performance.now() - tExec) / 1000).toFixed(2)}초`);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }
    const buf = await readFfmpegFileAsArrayBuffer(ffmpeg, outputName);
    console.log(`${tagLog} 출력 ${(buf.byteLength / 1024).toFixed(0)}KB — 전체 ${((performance.now() - t0) / 1000).toFixed(2)}초`);
    return new File([buf], outputName, { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", onProgress);
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
