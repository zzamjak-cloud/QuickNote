// 일반 파일(동영상·PDF·zip 등) 업로드. image-presign Lambda 를 그대로 재사용한다.
// PreSignedURL 발급 → S3 PUT → confirmImage 흐름은 동일하며 ref scheme 만 file:// 로 분리.

import { appsyncClient } from "../sync/graphql/client";
import {
  GET_IMAGE_UPLOAD_URL,
  CONFIRM_IMAGE,
} from "../sync/graphql/operations";
import { encodeFileRef } from "./scheme";

const MAX_BYTES = 100 * 1024 * 1024;

type GetImageUploadUrlResponse = {
  data: {
    getImageUploadUrl: {
      imageId: string;
      uploadUrl: string;
      expiresAt: string;
    };
  };
};

export type UploadedFile = {
  ref: string;
  mimeType: string;
  size: number;
  name: string;
};

export async function uploadFile(file: File): Promise<UploadedFile> {
  if (file.size <= 0) throw new Error("empty file");
  if (file.size > MAX_BYTES) {
    throw new Error(`too large: ${(file.size / 1024 / 1024).toFixed(1)} MB > 100 MB`);
  }
  // 탐색기 → Ctrl+V 등 일부 케이스에서 file.type 이 비어 있다 — octet-stream 폴백.
  const mimeType = file.type || "application/octet-stream";

  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);

  const presignRes = (await appsyncClient().graphql({
    query: GET_IMAGE_UPLOAD_URL,
    variables: {
      input: { mimeType, size: file.size, sha256 },
    },
  })) as GetImageUploadUrlResponse;
  const { imageId, uploadUrl } = presignRes.data.getImageUploadUrl;

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`upload failed: ${putRes.status}`);
  }

  await appsyncClient().graphql({
    query: CONFIRM_IMAGE,
    variables: { imageId },
  });

  return {
    ref: encodeFileRef(imageId),
    mimeType,
    size: file.size,
    name: file.name,
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
