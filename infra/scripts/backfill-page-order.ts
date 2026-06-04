/**
 * 백필 — byDatabaseAndOrder GSI 키로 부적합한 NULL 타입 속성을 정리한다.
 *
 * 배경:
 * - byDatabaseAndOrder GSI(파티션=databaseId, 정렬=order, 둘 다 STRING)가 추가되면서,
 *   non-row 페이지에 databaseId 가 NULL 타입으로 저장돼 있으면 GSI 키 검증에 걸려
 *   해당 페이지의 모든 쓰기(upsertPage Put / softDeletePage Update)가
 *   "Type mismatch ... actual: NULL IndexName: byDatabaseAndOrder" 로 거부된다.
 * - 같은 이유로 order 가 NULL 타입인 row 페이지도 거부 대상이다(현재 데이터엔 없으나 방어).
 *
 * 처리:
 * - databaseId 가 NULL 타입이면 속성 자체를 REMOVE → sparse GSI 에서 자연 제외, 쓰기 정상화.
 * - order 가 NULL 타입이면 createdAt→updatedAt epoch ms 문자열로 SET(정렬 키 복구).
 *   (order 누락/문자열이 아닌 NULL 타입만 대상. 유효 문자열 order 는 건드리지 않는다.)
 *
 * 안전장치:
 * - 기본 DRY-RUN(쓰기 없음). 실제 기록은 `--apply` 플래그가 있을 때만.
 * - 멱등: NULL 타입이 아닌 항목은 건너뛴다. 재실행해도 안전.
 *
 * 실행:
 *   cd infra
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-page-order.ts          # dry-run
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-page-order.ts --apply  # 실제 기록
 *
 * 자격증명: 기본 AWS 자격증명 체인(env/SSO/프로파일).
 * 테이블명: 기본 "quicknote-page", 필요 시 PAGES_TABLE_NAME 으로 오버라이드.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const PAGES_TABLE = process.env.PAGES_TABLE_NAME ?? "quicknote-page";
const APPLY = process.argv.includes("--apply");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** order(NULL 타입 복구용) → createdAt→updatedAt epoch ms 문자열. 실패 시 "0". */
function orderValueFrom(createdAt: unknown, updatedAt: unknown): string {
  for (const v of [createdAt, updatedAt]) {
    if (typeof v === "string" && v) {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) return String(ms);
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "0";
}

async function main(): Promise<void> {
  console.log(
    `[backfill-page-order] table=${PAGES_TABLE} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );
  let scanned = 0;
  let dbIdRemoved = 0;
  let orderFixed = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: PAGES_TABLE,
        ExclusiveStartKey: exclusiveStartKey,
        // DocumentClient 는 NULL 타입을 JS null 로 언마샬한다.
        // "키가 존재하고 값이 null" => NULL 타입으로 판정.
        ProjectionExpression: "id, #order, createdAt, updatedAt, databaseId",
        ExpressionAttributeNames: { "#order": "order" },
      }),
    );
    for (const item of res.Items ?? []) {
      scanned += 1;
      const removeDatabaseId = "databaseId" in item && item.databaseId == null;
      const fixOrder = "order" in item && item.order == null;
      if (!removeDatabaseId && !fixOrder) continue;

      const sets: string[] = [];
      const removes: string[] = [];
      const values: Record<string, unknown> = {};
      const names: Record<string, string> = {};
      if (removeDatabaseId) removes.push("databaseId");
      if (fixOrder) {
        sets.push("#order = :o");
        names["#order"] = "order";
        values[":o"] = orderValueFrom(item.createdAt, item.updatedAt);
      }
      const expr = [
        sets.length ? `SET ${sets.join(", ")}` : "",
        removes.length ? `REMOVE ${removes.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (!APPLY) {
        console.log(
          `  would ${expr}  id=${item.id}${removeDatabaseId ? " [databaseId:NULL]" : ""}${fixOrder ? " [order:NULL]" : ""}`,
        );
        if (removeDatabaseId) dbIdRemoved += 1;
        if (fixOrder) orderFixed += 1;
        continue;
      }
      await ddb.send(
        new UpdateCommand({
          TableName: PAGES_TABLE,
          Key: { id: item.id },
          UpdateExpression: expr,
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        }),
      );
      if (removeDatabaseId) dbIdRemoved += 1;
      if (fixOrder) orderFixed += 1;
    }
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  console.log(
    `[backfill-page-order] done. scanned=${scanned} databaseId제거=${dbIdRemoved} order복구=${orderFixed}`,
  );
  if (!APPLY && dbIdRemoved + orderFixed > 0) {
    console.log("[backfill-page-order] DRY-RUN — 실제 기록하려면 --apply 로 재실행하세요.");
  }
}

main().catch((err) => {
  console.error("[backfill-page-order] 실패", err);
  process.exit(1);
});
