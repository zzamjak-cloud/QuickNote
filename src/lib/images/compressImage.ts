// 이미지를 WebP로 압축 (최대 너비 1920px, 기본 품질 0.82)
export async function compressImage(
  file: File,
  maxWidth = 1920,
  quality = 0.82,
): Promise<Blob> {
  const img = await loadImage(file);
  const { width, height } = scaleDimensions(img.naturalWidth, img.naturalHeight, maxWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스 컨텍스트를 가져오지 못했습니다.");
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("압축 실패"))),
      "image/webp",
      quality,
    );
  });
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

function scaleDimensions(w: number, h: number, maxW: number): { width: number; height: number } {
  if (w <= maxW) return { width: w, height: h };
  return { width: maxW, height: Math.round((h * maxW) / w) };
}
