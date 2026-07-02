import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "../_shared/env";
import { collectFromValue } from "./collect";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

// 이미지 GC — 리포트 전용(2026-07 결정).
//
// 자동 삭제는 하지 않는다. 사용 중 자산을 잘못 지우는 위험(2026-07 사고)이
// 스토리지 절감액(이 규모에선 월 수십 센트)보다 훨씬 크기 때문이다.
// "완벽한 도달성 계산"에 의존하는 mark-and-sweep 은 협업 doc 지연·참조 위치
// 누락 등으로 구조적으로 취약하다. 따라서 여기서는 고아 후보만 집계·로그하고,
// 실제 삭제는 사람이 리포트를 확인한 뒤 수동으로 수행한다.
//
// - 미완료 PENDING 업로드는 ImageAsset TTL(expireAt)이 무료·안전하게 정리한다(코드 무관).
// - S3 버저닝 + 라이프사이클(180일)은 수동/우발 삭제의 복구 안전망으로 유지한다.
//
// 도달성 소스(리포트 정확도를 위해 참조 저장소를 추가하면 여기에도 반영):
//   Page(doc·dbCells·icon·coverImage), CustomIcons(src),
//   Page/DatabaseHistory(snapshot), AssetUsage(사용 인덱스).

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PAGE_TABLE = requireEnv("PAGE_TABLE");
const IMAGE_ASSET_TABLE = requireEnv("IMAGE_ASSET_TABLE");
const IMAGES_BUCKET = requireEnv("IMAGES_BUCKET");
const CUSTOM_ICONS_TABLE = requireEnv("CUSTOM_ICONS_TABLE");
const PAGE_HISTORY_TABLE = requireEnv("PAGE_HISTORY_TABLE");
const DATABASE_HISTORY_TABLE = requireEnv("DATABASE_HISTORY_TABLE");
const ASSET_USAGE_TABLE = requireEnv("ASSET_USAGE_TABLE");
const GRACE_DAYS = 30;
const UNTRACKED_S3_GRACE_DAYS = 7;
/** 리포트에 남길 샘플 최대 개수(로그 크기 제한). */
const SAMPLE_LIMIT = 50;

export async function handler() {
  const pageCount = { value: 0 };
  const reachable = await collectReachableImageIds(pageCount);
  await collectCustomIconRefs(reachable);
  await collectHistorySnapshotRefs(reachable);
  await collectAssetUsageRefs(reachable);

  // 스캔 결과가 비정상이면(빈 테이블·전면 파싱 실패 의심) 리포트를 신뢰할 수 없으므로 중단.
  if (pageCount.value === 0 || reachable.size === 0) {
    const summary = {
      aborted: "empty-reachability",
      pages: pageCount.value,
      reachable: reachable.size,
    };
    console.error("gc aborted", JSON.stringify(summary));
    return summary;
  }

  // 고아 후보: GRACE_DAYS 지난 READY 자산 중 어디서도 참조되지 않는 것. (삭제하지 않음)
  const orphanCandidates = await findReadyOrphans(reachable);

  // 미추적 S3 후보: 레지스트리 행 없이 S3 에만 남은 객체. (삭제하지 않음)
  const knownKeys = await collectKnownAssetKeys();
  const untrackedS3Keys = await findUntrackedS3Keys(knownKeys);

  const summary = {
    mode: "report-only",
    pages: pageCount.value,
    reachable: reachable.size,
    orphanCandidates: orphanCandidates.length,
    orphanSample: orphanCandidates.slice(0, SAMPLE_LIMIT).map((o) => o.id),
    untrackedS3: untrackedS3Keys.length,
    untrackedSample: untrackedS3Keys.slice(0, SAMPLE_LIMIT),
  };
  console.log("gc report", JSON.stringify(summary));
  return summary;
}

async function collectReachableImageIds(pageCount: { value: number }): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: PAGE_TABLE,
        ProjectionExpression: "id, doc, dbCells, icon, coverImage",
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const item of r.Items ?? []) {
      pageCount.value += 1;
      collectFromValue(item.doc, ids);
      collectFromValue(item.dbCells, ids);
      collectFromValue(item.icon, ids);
      collectFromValue(item.coverImage, ids);
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return ids;
}

/** 커스텀 아이콘 팔레트(src) 참조. */
async function collectCustomIconRefs(out: Set<string>): Promise<void> {
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: CUSTOM_ICONS_TABLE,
        ProjectionExpression: "src",
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const item of r.Items ?? []) collectFromValue(item.src, out);
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
}

/** 버전 히스토리 snapshot(doc·dbCells) 참조. */
async function collectHistorySnapshotRefs(out: Set<string>): Promise<void> {
  for (const table of [PAGE_HISTORY_TABLE, DATABASE_HISTORY_TABLE]) {
    let nextToken: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(
        new ScanCommand({
          TableName: table,
          // snapshot 은 DynamoDB 예약어라 alias 필요.
          ProjectionExpression: "#s",
          ExpressionAttributeNames: { "#s": "snapshot" },
          ExclusiveStartKey: nextToken,
        }),
      );
      for (const item of r.Items ?? []) collectFromValue(item.snapshot, out);
      nextToken = r.LastEvaluatedKey;
    } while (nextToken);
  }
}

/** 자산 사용 인덱스 — 페이지 저장 시 기록되는 사용처. */
async function collectAssetUsageRefs(out: Set<string>): Promise<void> {
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: ASSET_USAGE_TABLE,
        ProjectionExpression: "assetId",
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const item of r.Items ?? []) {
      if (typeof item.assetId === "string" && item.assetId) out.add(item.assetId);
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
}

/** GRACE_DAYS 지난 READY 자산 중 미참조 후보를 byStatus GSI 로 수집(삭제하지 않음). */
async function findReadyOrphans(
  reachable: Set<string>,
): Promise<{ id: string; key?: string }[]> {
  const cutoffIso = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const orphans: { id: string; key?: string }[] = [];
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: IMAGE_ASSET_TABLE,
        IndexName: "byStatus",
        KeyConditionExpression: "#s = :ready AND createdAt < :cutoff",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":ready": "READY", ":cutoff": cutoffIso },
        ExclusiveStartKey: nextToken,
      }),
    );
    for (const it of r.Items ?? []) {
      const id = it.id as string | undefined;
      if (typeof id === "string" && !reachable.has(id)) {
        orphans.push({ id, key: typeof it.key === "string" ? it.key : undefined });
      }
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);
  return orphans;
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
