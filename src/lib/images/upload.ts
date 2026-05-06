// v4 이미지 업로드: PreSignedURL 발급 → S3 PUT → confirmImage.
// 결과는 `quicknote-image://{imageId}` 가상 스킴 ref 로 반환되어 doc.attrs.src 에 저장된다.

import { appsyncClient } from "../sync/graphql/client";
import {
  GET_IMAGE_UPLOAD_URL,
  CONFIRM_IMAGE,
} from "../sync/graphql/operations";
import { encodeImageRef } from "../sync/imageScheme";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 20 * 1024 * 1024;

type GetImageUploadUrlResponse = {
  data: {
    getImageUploadUrl: {
      imageId: string;
      uploadUrl: string;
      expiresAt: string;
    };
  };
};

export async function uploadImage(file: File): Promise<string> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`unsupported mime: ${file.type}`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`too large: ${file.size}`);
  }
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);

  const presignRes = (await appsyncClient().graphql({
    query: GET_IMAGE_UPLOAD_URL,
    variables: {
      input: { mimeType: file.type, size: file.size, sha256 },
    },
  })) as GetImageUploadUrlResponse;
  const { imageId, uploadUrl } = presignRes.data.getImageUploadUrl;

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`upload failed: ${putRes.status}`);
  }

  await appsyncClient().graphql({
    query: CONFIRM_IMAGE,
    variables: { imageId },
  });

  return encodeImageRef(imageId);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
