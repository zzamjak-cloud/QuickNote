import { createHash } from "node:crypto";
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
  QueryCommand,
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

type UploadInput = { mimeType: string; size: number; sha256: string; name?: string; compressed?: boolean };

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

  let imageId = createStableAssetId(ownerId, input);
  // mimeType 의 subtype 을 기본 확장자로 사용. octet-stream 등 특수 케이스는 dat 로 폴백.
  // image 명명을 유지하지만 실제로는 모든 파일 종류를 같은 bucket prefix(users/{owner}/images/) 에 저장.
  const subtype = input.mimeType.split("/")[1] ?? "dat";
  const ext = subtype.replace("jpeg", "jpg").replace("svg+xml", "svg");
  const key = `users/${ownerId}/images/${imageId}.${ext}`;
  const expireAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // pending 1일 TTL
  const found = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: imageId } }));
  let existingKey = typeof found.Item?.key === "string" ? found.Item.key : key;
  let alreadyUploaded = found.Item?.ownerId === ownerId && found.Item?.status === "READY";

  if (found.Item && found.Item.ownerId !== ownerId) {
    throw new Error("not found");
  }

  if (!found.Item) {
    const reusable = await findReusableReadyAsset(ownerId, input);
    if (reusable) {
      imageId = reusable.id;
      existingKey = reusable.key;
      alreadyUploaded = true;
    } else {
      await createPendingAsset(imageId, ownerId, input, key, expireAt);
    }
  }

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: existingKey,
    ContentType: input.mimeType,
    ContentLength: input.size,
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });
  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();

  return { imageId, uploadUrl, expiresAt, alreadyUploaded };
}

async function findReusableReadyAsset(
  ownerId: string,
  input: UploadInput,
): Promise<{ id: string; key: string } | null> {
  let nextToken: Record<string, unknown> | undefined;
  do {
    const found = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "byOwner",
        KeyConditionExpression: "ownerId = :owner",
        FilterExpression: "#s = :ready AND mimeType = :mime AND #size = :size AND sha256 = :sha",
        ProjectionExpression: "id, #k",
        ExpressionAttributeNames: {
          "#s": "status",
          "#size": "size",
          "#k": "key",
        },
        ExpressionAttributeValues: {
          ":owner": ownerId,
          ":ready": "READY",
          ":mime": input.mimeType,
          ":size": input.size,
          ":sha": input.sha256,
        },
        ExclusiveStartKey: nextToken,
      }),
    );
    const reusable = (found.Items ?? []).find(
      (item) => typeof item.id === "string" && typeof item.key === "string",
    );
    if (reusable) {
      return { id: reusable.id as string, key: reusable.key as string };
    }
    nextToken = found.LastEvaluatedKey;
  } while (nextToken);
  return null;
}

async function createPendingAsset(
  imageId: string,
  ownerId: string,
  input: UploadInput,
  key: string,
  expireAt: number,
) {
  try {
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
          // 자산 관리 UI 표시용 파일명 — 선택. 미전송 시 ID 로 폴백.
          ...(input.name ? { name: input.name } : {}),
          // 사용자 트리거 압축의 결과물이면 true → 자산 관리 탭이 재압축 버튼을 막는다.
          ...(input.compressed ? { compressed: true } : {}),
        },
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
  }
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

export function createStableAssetId(ownerId: string, input: UploadInput): string {
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

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: string }).name === "ConditionalCheckFailedException"
  );
}
