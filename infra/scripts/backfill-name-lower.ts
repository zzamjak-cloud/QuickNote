/**
 * #7 백필 — 기존 team/organization 에 nameLower 기록.
 *
 * 새 코드는 create/update 시에만 nameLower(=name.trim().toLowerCase())를 기록하므로,
 * 기존 row 는 byName GSI 에 색인되지 않아 이름 중복체크가 통과해버린다.
 * 이 스크립트가 두 테이블 전체에 nameLower 를 1회 채운다.
 *
 * 안전장치:
 * - 기본은 DRY-RUN(쓰기 없음). 실제 기록은 `--apply` 플래그가 있을 때만.
 * - 멱등: 이미 동일한 nameLower 가 있으면 건너뛴다(불필요한 쓰기 방지).
 *
 * 실행:
 *   cd infra
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-name-lower.ts          # dry-run
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-name-lower.ts --apply  # 실제 기록
 *
 * 자격증명: 기본 AWS 자격증명 체인. 테이블명은 아래 env 로 오버라이드 가능.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type TableSpec = {
  /** 사람이 읽는 라벨 */
  label: string;
  /** DynamoDB 테이블명 */
  tableName: string;
  /** 파티션 키 속성명 */
  pkName: string;
};

const TABLES: TableSpec[] = [
  {
    label: "teams",
    tableName: process.env.TEAMS_TABLE_NAME ?? "quicknote-teams",
    pkName: "teamId",
  },
  {
    label: "organizations",
    tableName: process.env.ORGANIZATIONS_TABLE_NAME ?? "quicknote-organizations",
    pkName: "organizationId",
  },
];

async function backfillTable(spec: TableSpec): Promise<void> {
  console.log(`\n[${spec.label}] table=${spec.tableName} pk=${spec.pkName}`);
  let startKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  let skippedSame = 0;
  let skippedNoName = 0;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: spec.tableName,
        ProjectionExpression: `${spec.pkName}, #n, nameLower`,
        ExpressionAttributeNames: { "#n": "name" },
        ExclusiveStartKey: startKey,
        Limit: 200,
      }),
    );
    for (const item of res.Items ?? []) {
      scanned += 1;
      const pk = item[spec.pkName] as string | undefined;
      const name = item.name as string | undefined;
      if (!pk) continue;
      if (typeof name !== "string" || name.trim().length === 0) {
        skippedNoName += 1;
        continue;
      }
      const computed = name.trim().toLowerCase();
      if (item.nameLower === computed) {
        skippedSame += 1;
        continue;
      }
      candidates += 1;
      if (!APPLY) continue;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: spec.tableName,
            Key: { [spec.pkName]: pk },
            UpdateExpression: "SET nameLower = :nl",
            ExpressionAttributeValues: { ":nl": computed },
          }),
        );
        updated += 1;
      } catch (err) {
        console.error(`  ✗ 업데이트 실패 ${spec.pkName}=${pk}`, err);
      }
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  console.log(
    `  완료 — 스캔 ${scanned}, 대상 ${candidates}` +
      (APPLY ? `, 기록 ${updated}` : ` (DRY-RUN)`) +
      `, 이미동일 ${skippedSame}, 이름없음 ${skippedNoName}`,
  );
}

async function main(): Promise<void> {
  console.log(`[backfill-name-lower] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  for (const spec of TABLES) {
    await backfillTable(spec);
  }
}

main().catch((err) => {
  console.error("[backfill-name-lower] 실패", err);
  process.exit(1);
});
