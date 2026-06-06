/**
 * #1 백필 — 기존 휴지통 페이지에 purgeAt(TTL, epoch seconds) 기록.
 *
 * 새 코드는 앞으로의 soft delete 에만 purgeAt 을 기록하므로,
 * 이미 휴지통에 있는(deletedAt 존재 + purgeAt 없음) 페이지는 TTL 대상이 되지 않는다.
 * 이 스크립트가 그 잔여분에 purgeAt = floor((deletedAt + 30일) / 1000) 을 1회 채운다.
 *
 * 안전장치:
 * - 기본은 DRY-RUN(쓰기 없음). 실제 기록은 `--apply` 플래그가 있을 때만.
 * - 멱등: purgeAt 이 이미 있는 항목은 ConditionExpression 으로 건너뛴다.
 * - epoch "초" 단위(밀리초 아님) — TTL 스펙 준수.
 *
 * 실행:
 *   cd infra
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-purge-at.ts          # dry-run
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-purge-at.ts --apply  # 실제 기록
 *
 * 자격증명: 기본 AWS 자격증명 체인(env/SSO/프로파일)을 사용한다.
 * 테이블명: 기본 "quicknote-page", 필요 시 PAGES_TABLE_NAME 으로 오버라이드.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 리졸버 TRASH_RETENTION_MS 와 동일해야 함
const PAGES_TABLE = process.env.PAGES_TABLE_NAME ?? "quicknote-page";
const APPLY = process.argv.includes("--apply");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** deletedAt(ISO) → purgeAt(epoch seconds). 파싱 실패 시 null. */
function purgeAtSecondsFrom(deletedAt: unknown): number | null {
  if (typeof deletedAt !== "string" || !deletedAt) return null;
  const ms = Date.parse(deletedAt);
  if (Number.isNaN(ms)) return null;
  return Math.floor((ms + TRASH_RETENTION_MS) / 1000);
}

async function main(): Promise<void> {
  console.log(
    `[backfill-purge-at] table=${PAGES_TABLE} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  let startKey: Record<string, unknown> | undefined;
  let _scanned = 0;
  let candidates = 0;
  let updated = 0;
  let skippedExisting = 0;
  let unparsable = 0;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: PAGES_TABLE,
        // deletedAt 있고 purgeAt 없는 항목만 — 스캔 후 필터(일회성이라 허용).
        FilterExpression: "attribute_exists(deletedAt) AND attribute_not_exists(purgeAt)",
        ProjectionExpression: "id, deletedAt",
        ExclusiveStartKey: startKey,
        Limit: 200,
      }),
    );
    for (const item of res.Items ?? []) {
      _scanned += 1;
      const id = item.id as string | undefined;
      if (!id) continue;
      const purgeAt = purgeAtSecondsFrom(item.deletedAt);
      if (purgeAt == null) {
        unparsable += 1;
        console.warn(`  ! deletedAt 파싱 불가, 건너뜀: id=${id} deletedAt=${String(item.deletedAt)}`);
        continue;
      }
      candidates += 1;
      if (!APPLY) continue;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: PAGES_TABLE,
            Key: { id },
            UpdateExpression: "SET purgeAt = :p",
            // 멱등 — 그 사이 purgeAt 이 생겼으면(복원 등) 건너뛴다.
            ConditionExpression: "attribute_exists(deletedAt) AND attribute_not_exists(purgeAt)",
            ExpressionAttributeValues: { ":p": purgeAt },
          }),
        );
        updated += 1;
      } catch (err) {
        if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
          skippedExisting += 1;
        } else {
          console.error(`  ✗ 업데이트 실패 id=${id}`, err);
        }
      }
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  console.log(
    `[backfill-purge-at] 완료 — 대상 ${candidates}건` +
      (APPLY
        ? `, 기록 ${updated}건, 조건충돌 스킵 ${skippedExisting}건`
        : ` (DRY-RUN: 실제 기록 없음. --apply 로 실행)`) +
      `, 파싱불가 ${unparsable}건`,
  );
}

main().catch((err) => {
  console.error("[backfill-purge-at] 실패", err);
  process.exit(1);
});
