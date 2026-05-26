// 사용자 트리거 자산 압축/변환 모듈.
// 1) GIF → MP4 (ffmpeg.wasm)
// 2) MP4 압축 — QuickFolder "보통 화질" 프리셋 (CRF 28 medium, ffmpeg.wasm)
// 3) JPG/PNG 압축 (Canvas, ffmpeg 불필요)
//
// 압축 자체만 담당. 업로드·ref 교체·옛 자산 삭제는 호출자(AdminAssetsTab) 에서 처리.

import { prepareImageFileForUpload } from "../images/compressImage";

let ffmpegInstance: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoadPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

/** ffmpeg.wasm 을 lazy load. 첫 호출에서 ~30MB 다운로드. */
async function loadFfmpeg(
  onProgress?: (msg: string) => void,
): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (!ffmpegLoadPromise) {
    onProgress?.("코덱 로드 중…");
    ffmpegLoadPromise = (async () => {
      const [{ FFmpeg }, coreModule, wasmModule] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/core?url"),
        import("@ffmpeg/core/wasm?url"),
      ]);
      const ffmpeg = new FFmpeg();
      const coreURL = (coreModule as { default: string }).default;
      const wasmURL = (wasmModule as { default: string }).default;
      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((err) => {
      ffmpegLoadPromise = null;
      throw err;
    });
  }
  return ffmpegLoadPromise;
}

export type CompressionResult = {
  file: File;
  /** 새 mime (변환 시 mp4 로 바뀜) */
  mimeType: string;
};

export function canCompress(mimeType: string): "gif-to-mp4" | "video" | "image" | null {
  if (mimeType === "image/gif") return "gif-to-mp4";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") return "image";
  return null;
}

export async function compressAsset(
  source: { mimeType: string; name: string; bytes: Uint8Array },
  onProgress?: (msg: string) => void,
): Promise<CompressionResult> {
  const kind = canCompress(source.mimeType);
  if (!kind) throw new Error(`지원하지 않는 형식: ${source.mimeType}`);

  if (kind === "image") {
    onProgress?.("이미지 압축 중…");
    const inputFile = new File([source.bytes as BlobPart], source.name, { type: source.mimeType });
    const out = await prepareImageFileForUpload(inputFile);
    return { file: out, mimeType: out.type };
  }

  const ffmpeg = await loadFfmpeg(onProgress);
  const safe = source.name.replace(/[^a-z0-9가-힣_.-]+/gi, "-").slice(0, 80) || "input";
  const inputName = `${crypto.randomUUID()}-${safe}`;
  const outputName = `${safe.replace(/\.[^.]+$/, "") || "out"}-compressed.mp4`;
  const onFfmpegProgress = (ev: { progress: number; time: number }) => {
    onProgress?.(`변환 중 ${Math.max(0, Math.min(100, Math.round(ev.progress * 100)))}%`);
  };
  ffmpeg.on("progress", onFfmpegProgress);
  try {
    await ffmpeg.writeFile(inputName, source.bytes);
    const args =
      kind === "gif-to-mp4"
        ? [
            "-i", inputName,
            "-vf", "fps=24,scale=min(1280\\,iw):-2:flags=fast_bilinear",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-an",
            outputName,
          ]
        : [
            "-i", inputName,
            "-map", "0:v:0",
            "-map", "0:a?",
            "-vf", "scale=min(1920\\,iw):-2",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            outputName,
          ];
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(outputName);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const outName = `${safe.replace(/\.[^.]+$/, "") || "out"}.mp4`;
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const file = new File([arrayBuffer], outName, { type: "video/mp4" });
    return { file, mimeType: "video/mp4" };
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
    try { await ffmpeg.deleteFile(inputName); } catch { /* MEMFS 미존재 무시 */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* MEMFS 미존재 무시 */ }
  }
}
