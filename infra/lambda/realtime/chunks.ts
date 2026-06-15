// 클라→서버 대용량 메시지의 chunk 재조립 버퍼.
// $default 라우트는 메시지마다 별도 Lambda 호출이라 stateless 이므로, 청크를
// DynamoDB(rt-chunks, TTL 60s)에 누적하고 모두 도착하면 원본 직렬화 문자열을 복원한다.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { type ChunkMsg } from "./protocol";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CHUNKS_TABLE!;
const TTL_SECONDS = 60;

// 청크 1개를 누적하고, 모든 청크가 도착했으면 원본 직렬화 문자열을 반환한다(아니면 null).
// 마지막 두 청크가 동시 도착하면 재조립이 2회 일어날 수 있으나, 호출부의 처리
// (Yjs update append/fan-out)는 멱등이라 무해하다.
export async function collectChunk(
  connectionId: string,
  c: ChunkMsg,
): Promise<string | null> {
  const bufKey = `${connectionId}#${c.id}`;
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        bufKey,
        i: c.i,
        n: c.n,
        body: c.body,
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
    }),
  );

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "bufKey = :b",
      ExpressionAttributeValues: { ":b": bufKey },
    }),
  );
  const items = res.Items ?? [];
  if (items.length < c.n) return null;

  // 모든 청크 도착: i 로 정렬 복원. 누락 인덱스가 있으면 아직 미완성.
  const parts = new Array<string>(c.n);
  for (const it of items) {
    const idx = it.i as number;
    if (idx >= 0 && idx < c.n) parts[idx] = it.body as string;
  }
  for (let k = 0; k < c.n; k++) if (parts[k] === undefined) return null;

  // 버퍼 정리(25개 단위 BatchWrite).
  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: items.slice(i, i + 25).map((it) => ({
            DeleteRequest: { Key: { bufKey, i: it.i } },
          })),
        },
      }),
    );
  }
  return parts.join("");
}
