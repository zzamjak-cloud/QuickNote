/**
 * 백필 — 기존 페이지/DB 히스토리 항목에 expiresAt(TTL, epoch seconds) 기록.
 *
 * 새 코드는 앞으로의 기록에만 expiresAt(보존 180일)을 넣으므로,
 * 기존 항목(expiresAt 없음)은 TTL 대상이 되지 않는다. 이 스크립트가
 * expiresAt = floor((createdAt + 180일) / 1000) 을 1회 채운다.
 * createdAt + 180일이 이미 지난 항목은 TTL 이 곧바로(최대 48h 내) 삭제한다.
 *
 * 안전장치:
 * - 기본은 DRY-RUN(쓰기 없음). 실제 기록은 `--apply` 플래그가 있을 때만.
 * - 멱등: expiresAt 이 이미 있는 항목은 ConditionExpression 으로 건너뛴다.
 * - epoch "초" 단위(밀리초 아님) — TTL 스펙 준수(purgeAt 과 동일 규칙).
 *
 * 실행:
 *   cd infra
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-history-expires-at.ts          # dry-run
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-history-expires-at.ts --apply  # 실제 기록
 *
 * 자격증명: 기본 AWS 자격증명 체인(env/SSO/프로파일)을 사용한다.
 * 테이블명: 기본 live("quicknote-*-history"), dev 는 PAGE_HISTORY_TABLE_NAME /
 * DATABASE_HISTORY_TABLE_NAME 으로 오버라이드(예: "devquicknote-page-history").
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// 리졸버 history.ts 의 HISTORY_RETENTION_DAYS 와 동일해야 함
const HISTORY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const PAGE_HISTORY_TABLE = process.env.PAGE_HISTORY_TABLE_NAME ?? "quicknote-page-history";
const DATABASE_HISTORY_TABLE =
  process.env.DATABASE_HISTORY_TABLE_NAME ?? "quicknote-database-history";
const APPLY = process.argv.includes("--apply");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** createdAt(ISO) → expiresAt(epoch seconds). 파싱 실패 시 null. */
function expiresAtSecondsFrom(createdAt: unknown): number | null {
  if (typeof createdAt !== "string" || !createdAt) return null;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return null;
  return Math.floor((ms + HISTORY_RETENTION_MS) / 1000);
}

async function backfillTable(tableName: string, pkName: "pageId" | "databaseId"): Promise<void> {
  console.log(
    `[backfill-history-expires-at] table=${tableName} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  let startKey: Record<string, unknown> | undefined;
  let candidates = 0;
  let alreadyExpiredNow = 0;
  let updated = 0;
  let skippedExisting = 0;
  let unparsable = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        // expiresAt 없는 항목만 — 스캔 후 필터(일회성이라 허용).
        FilterExpression: "attribute_not_exists(expiresAt)",
        ProjectionExpression: `${pkName}, historyId, createdAt`,
        ExclusiveStartKey: startKey,
        Limit: 200,
      }),
    );
    for (const item of res.Items ?? []) {
      const pk = item[pkName] as string | undefined;
      const historyId = item.historyId as string | undefined;
      if (!pk || !historyId) continue;
      const expiresAt = expiresAtSecondsFrom(item.createdAt);
      if (expiresAt == null) {
        unparsable += 1;
        console.warn(
          `  ! createdAt 파싱 불가, 건너뜀: ${pkName}=${pk} historyId=${historyId}`,
        );
        continue;
      }
      candidates += 1;
      if (expiresAt <= nowSec) alreadyExpiredNow += 1;
      if (!APPLY) continue;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { [pkName]: pk, historyId },
            UpdateExpression: "SET expiresAt = :e",
            // 멱등 — 그 사이 expiresAt 이 생겼으면(세션 갱신 등) 건너뛴다.
            ConditionExpression: "attribute_not_exists(expiresAt)",
            ExpressionAttributeValues: { ":e": expiresAt },
          }),
        );
        updated += 1;
      } catch (err) {
        if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
          skippedExisting += 1;
        } else {
          console.error(`  ✗ 업데이트 실패 ${pkName}=${pk} historyId=${historyId}`, err);
        }
      }
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  console.log(
    `[backfill-history-expires-at] ${tableName} 완료 — 대상 ${candidates}건` +
      ` (그중 즉시 만료 대상 ${alreadyExpiredNow}건)` +
      (APPLY
        ? `, 기록 ${updated}건, 조건충돌 스킵 ${skippedExisting}건`
        : ` (DRY-RUN: 실제 기록 없음. --apply 로 실행)`) +
      `, 파싱불가 ${unparsable}건`,
  );
}

async function main(): Promise<void> {
  await backfillTable(PAGE_HISTORY_TABLE, "pageId");
  await backfillTable(DATABASE_HISTORY_TABLE, "databaseId");
}

main().catch((err) => {
  console.error("[backfill-history-expires-at] 실패", err);
  process.exit(1);
});
