// upload_image — 클라 uploadImage(presign → S3 PUT → confirmImage)와 같은 결과를 서버에서 직접 만든다:
// 같은 자산 id 규칙(createStableAssetId)·S3 키(users/{sub}/images/{id}.{ext})·ImageAssets READY 행·
// 워크스페이스 provisional AssetUsage(confirmImage 와 같은 sk) → 본문에 넣을 quicknote-image:// 참조를 돌려준다.
import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { createStableAssetId } from "../../../_shared/assetId";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { nowIso } from "../../pageWrite";
import { requireWritableWorkspace } from "../../writeAccess";
import { IMAGE_REF_PREFIX } from "./appearance";
import { contentTables, idInput, requireConfigured } from "./shared";
import { fetchPublicBytes } from "./urlFetch";

/** 클라 이미지 업로드 상한(src/lib/images/upload.ts MAX_BYTES)과 같다. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// MCP 요청 본문 상한(1MB) 안에 들어가는 base64 길이.
const MAX_BASE64_CHARS = 1_000_000;

const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });

export const uploadImageInputShape = {
  workspaceId: idInput.describe("Workspace where the image will be used (members of it can view the image)"),
  url: z.string().trim().min(1).max(2048).optional().describe("Public http(s) image URL to download (max 20 MB)"),
  data: z.string().trim().min(1).max(MAX_BASE64_CHARS).optional()
    .describe("Base64 image bytes or a data: URL (about 700 KB max — use url for larger images)"),
  name: z.string().trim().min(1).max(200).optional().describe("File name shown in asset management"),
  alt: z.string().trim().max(200).optional().describe("Alt text for the returned markdown snippet"),
};
const uploadImageInput = z.object(uploadImageInputShape);

type Sniffed = { mimeType: string; ext: string };

/** 매직 바이트로 형식 판정 — 선언 mime 은 믿지 않는다(SVG 등 실행 가능 형식 차단). */
export function sniffImage(bytes: Buffer): Sniffed | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return { mimeType: "image/gif", ext: "gif" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mimeType: "image/webp", ext: "webp" };
  }
  return null;
}

function decodeBase64(data: string): Buffer {
  const body = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  if (!/^[A-Za-z0-9+/=\s_-]+$/.test(body)) throw new ToolError("data must be base64");
  return Buffer.from(body, "base64");
}

async function loadBytes(input: z.infer<typeof uploadImageInput>): Promise<Buffer> {
  if (Boolean(input.url) === Boolean(input.data)) throw new ToolError("Pass exactly one of url or data");
  const bytes = input.data ? decodeBase64(input.data) : await fetchPublicBytes(input.url as string, MAX_IMAGE_BYTES);
  if (bytes.length === 0) throw new ToolError("The image is empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ToolError(`Image is larger than ${MAX_IMAGE_BYTES} bytes`);
  return bytes;
}

function defaultName(input: z.infer<typeof uploadImageInput>, ext: string): string {
  if (input.name) return input.name;
  let last = "";
  try {
    last = input.url ? decodeURIComponent(new URL(input.url).pathname.split("/").pop() ?? "") : "";
  } catch {
    last = "";
  }
  return last.slice(0, 200) || `image.${ext}`;
}

export async function uploadImageTool(ctx: McpContext, raw: z.input<typeof uploadImageInput>) {
  const input = uploadImageInput.parse(raw);
  await requireWritableWorkspace(ctx, input.workspaceId);
  const bucket = requireConfigured(contentTables(ctx).ImagesBucketName, "Image upload");
  const ownerId = ctx.caller.cognitoSub;
  if (!ownerId) throw new ToolError("This account cannot own uploaded images (no login identity)");
  const bytes = await loadBytes(input);
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new ToolError("Unsupported image format (PNG, JPEG, GIF or WebP only)");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetId = createStableAssetId(ownerId, { mimeType: sniffed.mimeType, size: bytes.length, sha256 });
  const existing = await getItem(ctx.doc, ctx.tables.ImageAssets, { id: assetId });
  if (existing && existing.ownerId !== ownerId) throw new ToolError("Image id collision; try again with different bytes");
  const reused = existing?.status === "READY";
  if (!reused) {
    const key = typeof existing?.key === "string" ? existing.key : `users/${ownerId}/images/${assetId}.${sniffed.ext}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: sniffed.mimeType, ContentLength: bytes.length }));
    await ctx.doc.send(new PutCommand({
      TableName: ctx.tables.ImageAssets,
      Item: {
        id: assetId, ownerId, mimeType: sniffed.mimeType, size: bytes.length, sha256,
        status: "READY", createdAt: nowIso(), key, name: defaultName(input, sniffed.ext),
      },
    }));
  }
  // confirmImage 와 같은 선제 사용처 — 본문 저장 전에도 워크스페이스 멤버가 이미지를 열람할 수 있게 한다.
  await ctx.doc.send(new PutCommand({
    TableName: ctx.tables.AssetUsage,
    Item: { assetId, sk: `WS#${input.workspaceId}#PROVISIONAL`, ownerId, workspaceId: input.workspaceId, provisional: true, updatedAt: nowIso() },
  }));
  const ref = `${IMAGE_REF_PREFIX}${assetId}`;
  return {
    assetId,
    ref,
    markdown: `![${(input.alt ?? "").replace(/[[\]]/g, "")}](${ref})`,
    mimeType: sniffed.mimeType,
    size: bytes.length,
    reused,
    note: "Put markdown on its own line in create_pages/update_page content, or use ref as a page cover (set_page_appearance).",
  };
}
