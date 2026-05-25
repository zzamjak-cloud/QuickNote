// 파일 타입 판별 헬퍼. (자동 변환/압축은 사용성 문제로 제거됨 — 파일은 첨부된 그대로 업로드한다)

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv|avi|mkv|mpg|mpeg|3gp)$/i.test(file.name);
}

export function isGifFile(file: File): boolean {
  return file.type === "image/gif" || /\.gif$/i.test(file.name);
}
