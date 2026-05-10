// 이미지 업로드 전 리사이즈·WebP 재인코딩으로 용량을 줄인다.

/**
 * 페이지 커버 배너(에디터 상단 `h-40` 스트립, `object-cover`)에 맞춘 가로형 비율.
 * 일반 본문 이미지(1920×3840 박스)와 다르게 좁은 띠만 쓰이므로 세로 해상도를 줄여 용량을 아낀다.
 */
const COVER_BANNER_ASPECT_W_PER_H = 4;
/** 로컬 2x·전폭 레이아웃까지 커버할 출력 폭 상한(px). */
const COVER_MAX_OUTPUT_WIDTH_PX = 1280;
const COVER_WEBP_QUALITY = 0.82;

export type CompressRasterOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

const DEFAULT_OPTS: Required<CompressRasterOptions> = {
  maxWidth: 1920,
  maxHeight: 3840,
  quality: 0.82,
};

/**
 * 래스터 이미지를 WebP Blob 으로 압축한다.
 * GIF 는 호출부에서 제외할 것(애니메이션 보존).
 */
export async function compressImage(
  file: File,
  opts: CompressRasterOptions = {},
): Promise<Blob> {
  const maxWidth = opts.maxWidth ?? DEFAULT_OPTS.maxWidth;
  const maxHeight = opts.maxHeight ?? DEFAULT_OPTS.maxHeight;
  const quality = opts.quality ?? DEFAULT_OPTS.quality;
  const img = await loadImage(file);
  const { width, height } = scaleDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxWidth,
    maxHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스 컨텍스트를 가져오지 못했습니다.");
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("압축 실패"))),
      "image/webp",
      quality,
    );
  }).finally(() => {
    canvas.width = 0;
    canvas.height = 0;
  });
}

/**
 * S3 업로드 직전 파일 준비: GIF 는 원본 유지, 나머지는 압축 WebP File 로 변환.
 * 압축 실패 시 원본 파일을 그대로 반환한다.
 */
export async function prepareImageFileForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;
  try {
    const blob = await compressImage(file);
    const base =
      file.name.replace(/\.[^.]+$/, "").trim() || "image";
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}

/**
 * 원본 픽셀에서 배너 가로세로비에 맞춘 중앙 크롭 소스 영역(테스트·단위 분리용).
 */
export function coverBannerCropSource(
  w: number,
  h: number,
  aspectWPerH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  let sx = 0;
  let sy = 0;
  let sw = w;
  let sh = h;
  const imgAspect = w / h;
  const targetAspect = aspectWPerH;
  if (imgAspect > targetAspect) {
    sw = h * targetAspect;
    sx = (w - sw) / 2;
  } else if (imgAspect < targetAspect) {
    sh = w / targetAspect;
    sy = (h - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

/**
 * 커버 전용: 배너 비율(가로:세로)로 중앙 크롭 후 최대 폭 제한·WebP 인코딩.
 * 표시는 여전히 뷰포트·전폭 토글에 따라 `object-cover` 로 동적으로 맞춰진다.
 */
export async function compressCoverImage(file: File): Promise<Blob> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const { sx, sy, sw, sh } = coverBannerCropSource(
    w,
    h,
    COVER_BANNER_ASPECT_W_PER_H,
  );

  const outW = Math.min(Math.round(sw), COVER_MAX_OUTPUT_WIDTH_PX);
  const outH = Math.max(
    1,
    Math.round(outW / COVER_BANNER_ASPECT_W_PER_H),
  );

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스 컨텍스트를 가져오지 못했습니다.");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("커버 압축 실패"))),
      "image/webp",
      COVER_WEBP_QUALITY,
    );
  }).finally(() => {
    canvas.width = 0;
    canvas.height = 0;
  });
}

/**
 * 커버 S3 업로드 직전: 크롭·저해상도 WebP. GIF 는 애니메이션 유지를 위해 일반 이미지 파이프라인으로 폴백.
 */
export async function prepareCoverImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") {
    return prepareImageFileForUpload(file);
  }
  try {
    const blob = await compressCoverImage(file);
    const base = file.name.replace(/\.[^.]+$/, "").trim() || "cover";
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return prepareImageFileForUpload(file);
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}

function scaleDimensions(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxW / w, maxH / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
