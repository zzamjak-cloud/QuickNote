import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// AppSync JS 리졸버에서 invoke 되는 단일 핸들러.
// 3 fieldName(getImageUploadUrl/confirmImage/getImageDownloadUrl)을 분기 처리한다.

type AppSyncEvent = {
  info: {
    fieldName:
      | "getImageUploadUrl"
      | "confirmImage"
      | "getImageDownloadUrl";
  };
  identity: { sub: string };
  arguments: Record<string, unknown>;
};

type UploadInput = { mimeType: string; size: number; sha256: string };

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = requireEnv("IMAGES_BUCKET");
const TABLE = requireEnv("IMAGE_ASSET_TABLE");

// image 외 일반 파일(동영상·PDF·zip 등) 업로드를 같은 인프라로 처리한다.
// 위험 mimeType(HTML/JS/SVG 등 브라우저 실행 가능 형식) 은 차단해 XSS 회피.
const ALLOWED_MIME = new Set([
  // images
  "image/png", "image/jpeg", "image/webp", "image/gif",
  // video
  "video/mp4", "video/webm", "video/ogg", "video/quicktime",
  // audio
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4",
  // docs
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // archives
  "application/zip", "application/x-zip-compressed",
  "application/x-gzip", "application/gzip", "application/x-tar",
  "application/x-7z-compressed", "application/x-rar-compressed",
  // text
  "text/plain", "text/markdown", "text/csv",
  "application/json", "application/xml",
  // generic binary fallback (탐색기 → Ctrl+V 등이 mimeType 을 못 가져오는 경우)
  "application/octet-stream",
]);
const MAX_BYTES = 100 * 1024 * 1024;

export async function handler(event: AppSyncEvent) {
  const sub = event.identity?.sub;
  if (!sub) throw new Error("Unauthorized");
  switch (event.info.fieldName) {
    case "getImageUploadUrl":
      return getUploadUrl(sub, event.arguments.input as UploadInput);
    case "confirmImage":
      return confirmImage(sub, event.arguments.imageId as string);
    case "getImageDownloadUrl":
      return getDownloadUrl(sub, event.arguments.imageId as string);
    default:
      throw new Error(`Unknown fieldName: ${String(event.info.fieldName)}`);
  }
}

async function getUploadUrl(ownerId: string, input: UploadInput) {
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new Error(`mimeType not allowed: ${input.mimeType}`);
  }
  if (input.size <= 0 || input.size > MAX_BYTES) {
    throw new Error(`size out of range: ${input.size}`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new Error("invalid sha256");
  }

  const imageId = randomUUID();
  // mimeType 의 subtype 을 기본 확장자로 사용. octet-stream 등 특수 케이스는 dat 로 폴백.
  // image 명명을 유지하지만 실제로는 모든 파일 종류를 같은 bucket prefix(users/{owner}/images/) 에 저장.
  const subtype = input.mimeType.split("/")[1] ?? "dat";
  const ext = subtype.replace("jpeg", "jpg").replace("svg+xml", "svg");
  const key = `users/${ownerId}/images/${imageId}.${ext}`;
  const expireAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // pending 1일 TTL

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        id: imageId,
        ownerId,
        mimeType: input.mimeType,
        size: input.size,
        sha256: input.sha256,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        key,
        expireAt,
      },
      ConditionExpression: "attribute_not_exists(id)",
    }),
  );

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: input.mimeType,
    ContentLength: input.size,
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });
  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();

  return { imageId, uploadUrl, expiresAt };
}

async function confirmImage(ownerId: string, imageId: string) {
  const found = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { id: imageId } }),
  );
  if (!found.Item || found.Item.ownerId !== ownerId) {
    throw new Error("not found");
  }

  // S3 객체 검증 — 업로드 완료된 객체가 실제로 존재하는지.
  await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: found.Item.key }));

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { id: imageId },
      UpdateExpression: "SET #s = :ready REMOVE expireAt",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":ready": "READY",
        ":owner": ownerId,
      },
      ConditionExpression: "ownerId = :owner",
    }),
  );

  const updated = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { id: imageId } }),
  );
  return updated.Item;
}

async function getDownloadUrl(ownerId: string, imageId: string) {
  const found = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { id: imageId } }),
  );
  if (!found.Item || found.Item.ownerId !== ownerId) {
    throw new Error("not found");
  }
  if (found.Item.status !== "READY") throw new Error("not ready");

  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: found.Item.key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} not set`);
  return v;
}
