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

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 20 * 1024 * 1024;

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
  const ext = input.mimeType.split("/")[1].replace("jpeg", "jpg");
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
