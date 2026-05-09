/**
 * 삭제 후 보관 기간이 지난 페이지 레코드를 DynamoDB 에서 영구 삭제.
 * EventBridge 일일 실행. (pageDatabase.ts 의 TRASH_RETENTION_MS 와 동일해야 함)
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(): Promise<{ purged: number }> {
  const table = process.env.PAGES_TABLE_NAME;
  if (!table) throw new Error("PAGES_TABLE_NAME");
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  let lastKey: Record<string, unknown> | undefined;
  let purged = 0;
  do {
    const r = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression:
          "attribute_exists(deletedAt) AND deletedAt < :cutoff",
        ExpressionAttributeValues: { ":cutoff": cutoff },
        ExclusiveStartKey: lastKey,
        Limit: 100,
      }),
    );
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    for (const item of r.Items ?? []) {
      const id = item["id"] as string | undefined;
      if (!id) continue;
      await client.send(
        new DeleteCommand({ TableName: table, Key: { id } }),
      );
      purged += 1;
    }
  } while (lastKey);
  console.log(`[trash-purge] purged ${purged} pages (cutoff before ${cutoff})`);
  return { purged };
}
