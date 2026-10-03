// 작은 DDB 조회 헬퍼 — BatchGet(미처리 키 재시도 포함)·단건 Get.
import { BatchGetCommand, GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

type Item = Record<string, unknown>;

const BATCH_SIZE = 100;
const MAX_UNPROCESSED_RETRIES = 3;

export async function getItem(
  doc: DynamoDBDocumentClient,
  tableName: string,
  key: Item,
): Promise<Item | null> {
  const r = await doc.send(new GetCommand({ TableName: tableName, Key: key }));
  return (r.Item as Item | undefined) ?? null;
}

/** keyName 단일 PK 테이블 BatchGet. 순서 보장 없음 — 호출측이 id 로 매핑한다. */
export async function batchGetByKey(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  keyName: string;
  ids: string[];
  projection?: string;
  expressionNames?: Record<string, string>;
}): Promise<Item[]> {
  const ids = Array.from(new Set(args.ids.filter(Boolean)));
  const out: Item[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    let keys: Item[] = ids.slice(i, i + BATCH_SIZE).map((id) => ({ [args.keyName]: id }));
    for (let attempt = 0; keys.length > 0 && attempt <= MAX_UNPROCESSED_RETRIES; attempt += 1) {
      const r = await args.doc.send(
        new BatchGetCommand({
          RequestItems: {
            [args.tableName]: {
              Keys: keys,
              ...(args.projection ? { ProjectionExpression: args.projection } : {}),
              ...(args.expressionNames ? { ExpressionAttributeNames: args.expressionNames } : {}),
            },
          },
        }),
      );
      out.push(...((r.Responses?.[args.tableName] ?? []) as Item[]));
      keys = (r.UnprocessedKeys?.[args.tableName]?.Keys ?? []) as Item[];
    }
  }
  return out;
}
