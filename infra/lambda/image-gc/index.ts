import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

// 야간 GC.
// 1) Page 테이블에서 doc / dbCells 안의 quicknote-image/file ref 추출 → 도달 가능 set.
// 2) ImageAsset 테이블의 READY 미참조 항목, 오래된 PENDING 항목, DDB 없는 S3 객체 정리.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PAGE_TABLE = requireEnv("PAGE_TABLE");
const IMAGE_ASSET_TABLE = requireEnv("IMAGE_ASSET_TABLE");
const IMAGES_BUCKET = requireEnv("IMAGES_BUCKET");
const GRACE_DAYS = 30;
const PENDING_GRACE_DAYS = 1;
const UNTRACKED_S3_GRACE_DAYS = 2;
const SCHEMES = ["quicknote-image://", "quicknote-file://"];

export async function handler() {
  const reachable = await collectReachableImageIds();
  const orphans = await findReadyOrphans(reachable);
  const stalePending = await findStalePending();
  const knownKeys = await collectKnownAssetKeys();
  const untrackedS3Keys = await findUntrackedS3Keys(knownKeys);
  let deleted = 0;
  for (const item of [...orphans, ...stalePending]) {
    try {
      await deleteAsset(item);
      deleted += 1;
    } catch (err) {
      console.error("delete failed", item.id, err);
    }
  }
  for (const key of untrackedS3Keys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key }));
      deleted += 1;
    } catch (err) {
      console.error("delete untracked s3 failed", key, err);
    }
  }
  return {
    reachable: reachable.size,
    readyOrphans: orphans.length,
    stalePending: stalePending.length,
    untrackedS3: untrackedS3Keys.length,
    deleted,
  };
}

async function collectReachableImageIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: PAGE_TABLE,
        ProjectionExpression: "id, doc, dbCells",
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const item of r.Items ?? []) {
      collectFromValue(item.doc, ids);
      collectFromValue(item.dbCells, ids);
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return ids;
}

function collectFromValue(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const scheme of SCHEMES) {
      if (value.startsWith(scheme)) {
        out.add(value.slice(scheme.length));
        return;
      }
    }
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as object)) collectFromValue(v, out);
  }
}

async function findReadyOrphans(
  reachable: Set<string>,
): Promise<{ id: string; key: string }[]> {
  const cutoff = Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000;
  const orphans: { id: string; key: string }[] = [];
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: IMAGE_ASSET_TABLE,
        FilterExpression: "#s = :ready",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":ready": "READY" },
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const it of r.Items ?? []) {
      if (reachable.has(it.id as string)) continue;
      const created = Date.parse(it.createdAt as string);
      if (created < cutoff && typeof it.key === "string") {
        orphans.push({ id: it.id as string, key: it.key as string });
      }
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return orphans;
}

async function findStalePending(): Promise<{ id: string; key: string }[]> {
  const cutoff = Date.now() - PENDING_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const stale: { id: string; key: string }[] = [];
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: IMAGE_ASSET_TABLE,
        FilterExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":pending": "PENDING" },
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const it of r.Items ?? []) {
      const created = Date.parse(it.createdAt as string);
      if (created < cutoff && typeof it.key === "string") {
        stale.push({ id: it.id as string, key: it.key });
      }
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return stale;
}

async function collectKnownAssetKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: IMAGE_ASSET_TABLE,
        ProjectionExpression: "#k",
        ExpressionAttributeNames: { "#k": "key" },
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const it of r.Items ?? []) {
      if (typeof it.key === "string") keys.add(it.key);
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return keys;
}

async function findUntrackedS3Keys(knownKeys: Set<string>): Promise<string[]> {
  const cutoff = Date.now() - UNTRACKED_S3_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: IMAGES_BUCKET,
        Prefix: "users/",
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of r.Contents ?? []) {
      if (!obj.Key || knownKeys.has(obj.Key)) continue;
      const lastModified = obj.LastModified?.getTime() ?? Date.now();
      if (lastModified < cutoff) keys.push(obj.Key);
    }
    continuationToken = r.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function deleteAsset(item: { id: string; key: string }) {
  await s3.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: item.key }));
  await ddb.send(new DeleteCommand({ TableName: IMAGE_ASSET_TABLE, Key: { id: item.id } }));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} not set`);
  return v;
}
