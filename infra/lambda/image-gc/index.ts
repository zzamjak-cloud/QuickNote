import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "../_shared/env";
import { collectFromValue } from "./collect";
import { planOrphans, type AssetRow } from "./orphan";
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

// 야간 GC — 다층 방어(2026-07 오삭제 사고 이후 강화).
//
// 도달성 소스(참조 저장소를 추가하면 반드시 여기에도 반영할 것):
//   Page(doc·dbCells·icon·coverImage), CustomIcons(src),
//   Page/DatabaseHistory(snapshot), AssetUsage(사용 인덱스).
//
// 안전장치:
//   1) 2단계 삭제 — 처음 고아로 보이면 orphanSince 마킹만, ORPHAN_CONFIRM_DAYS
//      연속 고아일 때만 삭제(협업 doc 지연 등 일시 갭 면역).
//   2) 서킷브레이커 — 삭제 대상이 MAX_DELETE_PER_RUN 초과 또는 도달성 스캔이
//      비정상(페이지 0건·참조 0건)이면 전체 삭제를 중단하고 에러 로그(알람 연동).
//   3) 톰스톤 — 레지스트리 행 삭제 전 전체 row 를 gc-tombstones/ 에 JSON 백업.
//   4) S3 버저닝 + 라이프사이클(180일) — 삭제는 delete marker 로만 남아 복구 가능.

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
/** 한 런에서 삭제 가능한 최대 건수 — 초과 시 오탐(대량 삭제 사고)으로 간주하고 중단. */
const MAX_DELETE_PER_RUN = 200;
const TOMBSTONE_PREFIX = "gc-tombstones/";

export async function handler() {
  const pageCount = { value: 0 };
  const reachable = await collectReachableImageIds(pageCount);
  await collectCustomIconRefs(reachable);
  await collectHistorySnapshotRefs(reachable);
  await collectAssetUsageRefs(reachable);

  // 서킷브레이커: 스캔 결과가 비정상이면(빈 테이블·전면 파싱 실패 의심) 아무것도 지우지 않는다.
  if (pageCount.value === 0 || reachable.size === 0) {
    const summary = {
      aborted: "empty-reachability",
      pages: pageCount.value,
      reachable: reachable.size,
    };
    console.error("gc aborted", JSON.stringify(summary));
    return summary;
  }

  const oldReadyRows = await loadOldReadyRows();
  const plan = planOrphans(oldReadyRows, reachable, Date.now());

  // 참조가 다시 보인 자산 — 고아 마킹 해제.
  for (const row of plan.toReclaim) {
    await ddb.send(
      new UpdateCommand({
        TableName: IMAGE_ASSET_TABLE,
        Key: { id: row.id },
        UpdateExpression: "REMOVE orphanSince",
      }),
    );
  }

  // 처음 고아로 보인 자산 — 마킹만 (삭제는 확정 기간 이후).
  const nowIso = new Date().toISOString();
  for (const row of plan.toMark) {
    await ddb.send(
      new UpdateCommand({
        TableName: IMAGE_ASSET_TABLE,
        Key: { id: row.id },
        UpdateExpression: "SET orphanSince = :t",
        ExpressionAttributeValues: { ":t": nowIso },
      }),
    );
  }

  // 서킷브레이커: 확정 삭제가 비정상적으로 많으면 오탐으로 간주하고 중단.
  let deleted = 0;
  let deleteAborted = false;
  if (plan.toDelete.length > MAX_DELETE_PER_RUN) {
    deleteAborted = true;
    console.error(
      "gc delete aborted: too many candidates",
      JSON.stringify({ toDelete: plan.toDelete.length, cap: MAX_DELETE_PER_RUN }),
    );
  } else {
    for (const row of plan.toDelete) {
      try {
        await deleteAsset(row);
        deleted += 1;
      } catch (err) {
        console.error("delete failed", row.id, err);
      }
    }
  }

  // 오래된 PENDING 항목은 ImageAsset 테이블의 expireAt TTL 이 자동·무료로 정리한다.
  // TTL 은 DDB row 만 지우므로, 남은 S3 객체는 아래 untracked-S3 sweep 이 회수한다.
  const knownKeys = await collectKnownAssetKeys();
  const untrackedS3Keys = await findUntrackedS3Keys(knownKeys);
  let untrackedDeleted = 0;
  if (untrackedS3Keys.length > MAX_DELETE_PER_RUN) {
    console.error(
      "gc untracked sweep aborted: too many candidates",
      JSON.stringify({ untracked: untrackedS3Keys.length, cap: MAX_DELETE_PER_RUN }),
    );
  } else {
    for (const key of untrackedS3Keys) {
      try {
        // 버저닝 버킷이라 delete marker 만 생성 — 라이프사이클 만료 전까지 복구 가능.
        await s3.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: key }));
        untrackedDeleted += 1;
      } catch (err) {
        console.error("delete untracked s3 failed", key, err);
      }
    }
  }

  const summary = {
    pages: pageCount.value,
    reachable: reachable.size,
    marked: plan.toMark.length,
    reclaimed: plan.toReclaim.length,
    confirmedOrphans: plan.toDelete.length,
    deleted,
    deleteAborted,
    untrackedS3: untrackedS3Keys.length,
    untrackedDeleted,
  };
  console.log("gc summary", JSON.stringify(summary));
  return summary;
}

async function collectReachableImageIds(pageCount: { value: number }): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: PAGE_TABLE,
        // icon(커스텀 아이콘)·coverImage(커버) 도 자산 ref 를 담는다 — 누락 시 오삭제.
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

/** 커스텀 아이콘 팔레트(src) 참조 — 페이지에 설정돼 있지 않아도 팔레트 자산은 보존. */
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

/** 버전 히스토리 snapshot(doc·dbCells) 참조 — 복원 시 이미지가 살아있어야 한다. */
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

/** 자산 사용 인덱스 — 페이지 저장 시 기록되는 사용처. 협업 doc 지연 시에도 남는 안전망. */
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

/** GRACE_DAYS 지난 READY 행 전체를 base 테이블에서 로드(orphanSince 포함). */
async function loadOldReadyRows(): Promise<AssetRow[]> {
  // byStatus GSI 는 key 만 INCLUDE 라 orphanSince 를 못 본다 — id 만 뽑고 base 를 BatchGet.
  const cutoffIso = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ids: string[] = [];
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
      if (typeof it.id === "string") ids.push(it.id);
    }
    nextToken = r.LastEvaluatedKey;
  } while (nextToken);

  const rows: AssetRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let keys = ids.slice(i, i + 100).map((id) => ({ id }));
    while (keys.length > 0) {
      const r = await ddb.send(
        new BatchGetCommand({
          RequestItems: { [IMAGE_ASSET_TABLE]: { Keys: keys } },
        }),
      );
      for (const it of r.Responses?.[IMAGE_ASSET_TABLE] ?? []) {
        rows.push(it as AssetRow);
      }
      keys = (r.UnprocessedKeys?.[IMAGE_ASSET_TABLE]?.Keys ?? []) as { id: string }[];
    }
  }
  return rows;
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

async function deleteAsset(row: AssetRow) {
  // 삭제 전 레지스트리 행 전체를 톰스톤으로 백업 — 오삭제 시 행 복원 근거.
  await s3.send(
    new PutObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: `${TOMBSTONE_PREFIX}${new Date().toISOString().slice(0, 10)}/${row.id}.json`,
      Body: JSON.stringify(row),
      ContentType: "application/json",
    }),
  );
  if (typeof row.key === "string" && row.key) {
    // 버저닝 버킷이라 delete marker 만 생성 — 라이프사이클 만료 전까지 복구 가능.
    await s3.send(new DeleteObjectCommand({ Bucket: IMAGES_BUCKET, Key: row.key }));
  }
  await ddb.send(new DeleteCommand({ TableName: IMAGE_ASSET_TABLE, Key: { id: row.id } }));
}
