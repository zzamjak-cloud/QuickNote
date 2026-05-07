// 아바타 리사이즈 결과 타입
export type AvatarResult = {
  avatar256: string;
  thumbnail64: string;
};

// 이미지 파일을 256×256 크롭 + 64×64 썸네일로 변환
export function resizeAvatar(file: File): Promise<AvatarResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        avatar256: cropSquare(img, 256),
        thumbnail64: cropSquare(img, 64),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = objectUrl;
  });
}

// 이미지를 정사각형으로 센터 크롭 후 지정 크기로 리사이즈
function cropSquare(img: HTMLImageElement, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스 컨텍스트를 가져오지 못했습니다.");
  const { naturalWidth: w, naturalHeight: h } = img;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/webp", 0.85);
}
