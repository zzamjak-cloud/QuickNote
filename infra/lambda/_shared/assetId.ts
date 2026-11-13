// 자산 id 규칙 — 같은 소유자·mime·크기·sha256 이면 같은 id(중복 업로드 재사용).
// image-presign(클라 업로드)과 MCP upload_image 가 같은 id 를 만들어야 자산이 이중 등록되지 않는다.
import { createHash } from "node:crypto";

export type StableAssetInput = { mimeType: string; size: number; sha256: string };

export function createStableAssetId(ownerId: string, input: StableAssetInput): string {
  const digest = createHash("sha256")
    .update(ownerId)
    .update("\0")
    .update(input.mimeType)
    .update("\0")
    .update(String(input.size))
    .update("\0")
    .update(input.sha256)
    .digest("hex");
  return `asset-${digest}`;
}
