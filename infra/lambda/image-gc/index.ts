import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

// 야간 GC.
// 1) Page 테이블에서 doc / dbCells 안의 quicknote-image://{id} 추출 → 도달 가능 set.
// 2) ImageAsset 테이블의 READY 항목 중 도달 불가 + 30일 경과 → S3 + DDB 삭제.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PAGE_TABLE = requireEnv("PAGE_TABLE");
const IMAGE_ASSET_TABLE = requireEnv("IMAGE_ASSET_TABLE");
const IMAGES_BUCKET = requireEnv("IMAGES_BUCKET");
const GRACE_DAYS = 30;
const SCHEME = "quicknote-image://";

export async function handler() {
  const reachable = await collectReachableImageIds();
  const orphans = await findOrphans(reachable);
  let deleted = 0;
  for (const item of orphans) {
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: item.key }),
      );
      await ddb.send(
        new DeleteCommand({ TableName: IMAGE_ASSET_TABLE, Key: { id: item.id } }),
      );
      deleted += 1;
    } catch (err) {
      console.error("delete failed", item.id, err);
    }
  }
  return { reachable: reachable.size, scanned: orphans.length, deleted };
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
    if (value.startsWith(SCHEME)) out.add(value.slice(SCHEME.length));
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as object)) collectFromValue(v, out);
  }
}

async function findOrphans(
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
      if (created < cutoff) {
        orphans.push({ id: it.id as string, key: it.key as string });
      }
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return orphans;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} not set`);
  return v;
}
