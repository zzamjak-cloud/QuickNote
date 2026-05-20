// 일반 파일(동영상·PDF·zip 등) 업로드. image-presign Lambda 를 그대로 재사용한다.
// PreSignedURL 발급 → S3 PUT → confirmImage 흐름은 동일하며 ref scheme 만 file:// 로 분리.

import { appsyncClient } from "../sync/graphql/client";
import {
  GET_IMAGE_UPLOAD_URL,
  CONFIRM_IMAGE,
} from "../sync/graphql/operations";
import { encodeFileRef } from "./scheme";
import { isGifFile, prepareGifFileBlockForUpload, prepareVideoFileForUpload } from "./videoCompress";

const MAX_BYTES = 100 * 1024 * 1024;

type GetImageUploadUrlResponse = {
  data: {
    getImageUploadUrl: {
      imageId: string;
      uploadUrl: string;
      expiresAt: string;
      alreadyUploaded: boolean;
    };
  };
};

export type UploadedFile = {
  ref: string;
  mimeType: string;
  size: number;
  name: string;
};

export async function uploadFile(file: File, opts?: { alreadyPrepared?: boolean }): Promise<UploadedFile> {
  const fileToUpload = opts?.alreadyPrepared
    ? file
    : isGifFile(file)
      ? await prepareGifFileBlockForUpload(file)
      : await prepareVideoFileForUpload(file);
  if (fileToUpload.size <= 0) throw new Error("empty file");
  if (fileToUpload.size > MAX_BYTES) {
    throw new Error(`too large: ${(fileToUpload.size / 1024 / 1024).toFixed(1)} MB > 100 MB`);
  }
  // 탐색기 → Ctrl+V 등 일부 케이스에서 file.type 이 비어 있다.
  // .md 파일은 MIME 이 비어 있는 경우가 많아 text/markdown 으로 강제 지정.
  let mimeType = fileToUpload.type;
  if (!mimeType) {
    const ext = fileToUpload.name.split(".").pop()?.toLowerCase();
    if (ext === "md" || ext === "markdown") mimeType = "text/markdown; charset=utf-8";
    else mimeType = "application/octet-stream";
  }

  const buf = await fileToUpload.arrayBuffer();
  const sha256 = await sha256Hex(buf);

  const presignRes = (await appsyncClient().graphql({
    query: GET_IMAGE_UPLOAD_URL,
    variables: {
      input: { mimeType, size: fileToUpload.size, sha256 },
    },
  })) as GetImageUploadUrlResponse;
  const { imageId, uploadUrl, alreadyUploaded } = presignRes.data.getImageUploadUrl;

  if (!alreadyUploaded) {
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: fileToUpload,
    });
    if (!putRes.ok) {
      throw new Error(`upload failed: ${putRes.status}`);
    }

    await appsyncClient().graphql({
      query: CONFIRM_IMAGE,
      variables: { imageId },
    });
  }

  return {
    ref: encodeFileRef(imageId),
    mimeType,
    size: fileToUpload.size,
    name: fileToUpload.name,
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
