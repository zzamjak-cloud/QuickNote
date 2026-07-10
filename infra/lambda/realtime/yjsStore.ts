import * as Y from "yjs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const YDOC_TABLE = process.env.YDOC_TABLE!;
const YDOC_UPDATES_TABLE = process.env.YDOC_UPDATES_TABLE!;
const COMPACT_THRESHOLD = 50;

// 여러 update 바이트를 하나의 머지된 상태 update로 합친다.
export function mergeState(updates: Uint8Array[]): Uint8Array {
  return Y.mergeUpdates(updates);
}

// 머지된 서버 상태와 클라 state vector로 "클라가 모르는 변경"만 추출.
export function diffForClient(serverState: Uint8Array, clientStateVector: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState);
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}

// 머지된 서버 상태의 state vector.
export function stateVectorOf(serverState: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState);
  return Y.encodeStateVector(doc);
}

// 빈 Y.Doc 상태(최초 시드 폴백). 실제 본문 시드는 첫 클라이언트의 sv-reply로 채운다.
export function emptyState(): Uint8Array {
  return Y.encodeStateAsUpdate(new Y.Doc());
}

type UpdateLogItem = { seq: string; update: string };

// update 로그 전체 조회. Query 는 1MB 단위로 잘리므로 반드시 페이지네이션한다 —
// 잘린 결과로 머지/압축하면 뒷페이지 update 가 상태에서 빠져 본문이 유실된 것처럼 보인다.
async function queryAllUpdates(pageId: string): Promise<UpdateLogItem[]> {
  const items: UpdateLogItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new QueryCommand({
      TableName: YDOC_UPDATES_TABLE,
      KeyConditionExpression: "pageId = :p",
      ExpressionAttributeValues: { ":p": pageId },
      ExclusiveStartKey: lastKey,
    }));
    for (const it of page.Items ?? []) items.push({ seq: it.seq as string, update: it.update as string });
    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

// 페이지의 머지된 현재 상태(스냅샷 + 미압축 update 로그)를 로드.
export async function loadPageState(pageId: string): Promise<Uint8Array> {
  const snap = await ddb.send(new GetCommand({ TableName: YDOC_TABLE, Key: { pageId } }));
  const base: Uint8Array[] = [];
  const stateB64 = snap.Item?.state as string | undefined;
  if (stateB64) base.push(new Uint8Array(Buffer.from(stateB64, "base64")));
  for (const it of await queryAllUpdates(pageId)) base.push(new Uint8Array(Buffer.from(it.update, "base64")));
  if (base.length === 0) return emptyState();
  return Y.mergeUpdates(base);
}

// 새 update를 로그에 append. 로그가 임계 초과면 압축(스냅샷 갱신 + 로그 정리).
export async function appendPageUpdate(pageId: string, update: Uint8Array): Promise<void> {
  const seq = `${Date.now().toString().padStart(16, "0")}#${Math.random().toString(36).slice(2)}`;
  await ddb.send(new PutCommand({
    TableName: YDOC_UPDATES_TABLE,
    Item: { pageId, seq, update: Buffer.from(update).toString("base64") },
  }));
  const log = await ddb.send(new QueryCommand({
    TableName: YDOC_UPDATES_TABLE, KeyConditionExpression: "pageId = :p",
    ExpressionAttributeValues: { ":p": pageId }, Select: "COUNT",
  }));
  if ((log.Count ?? 0) >= COMPACT_THRESHOLD) await compactPage(pageId);
}

// 압축(스냅샷 갱신 + 로그 정리). 동시 편집 안전 규칙 2가지(회귀 금지):
// 1) 삭제는 "머지에 실제 포함한 항목만" — 머지 후 재조회해 전부 지우면, 그 사이 다른
//    Lambda 가 append 한 update 가 머지 없이 삭제돼 영구 유실된다(8인 동시 편집 사고).
// 2) 스냅샷 Put 은 version 조건부 — 동시 compaction 이 서로의 머지 결과를 덮어쓰면
//    한쪽이 머지한 update 가 스냅샷에서 빠진 채 로그에서 지워질 수 있다. 조건 실패 시
//    compaction 을 포기한다(로그가 남아 있으므로 다음 압축에서 재시도돼 안전).
async function compactPage(pageId: string): Promise<void> {
  const snap = await ddb.send(new GetCommand({ TableName: YDOC_TABLE, Key: { pageId } }));
  const version = snap.Item?.version as number | undefined;
  const base: Uint8Array[] = [];
  const stateB64 = snap.Item?.state as string | undefined;
  if (stateB64) base.push(new Uint8Array(Buffer.from(stateB64, "base64")));
  const items = await queryAllUpdates(pageId);
  if (items.length === 0) return;
  for (const it of items) base.push(new Uint8Array(Buffer.from(it.update, "base64")));
  const merged = Y.mergeUpdates(base);
  try {
    await ddb.send(new PutCommand({
      TableName: YDOC_TABLE,
      Item: {
        pageId,
        state: Buffer.from(merged).toString("base64"),
        version: (version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      },
      ConditionExpression: version === undefined ? "attribute_not_exists(version)" : "version = :v",
      ...(version === undefined ? {} : { ExpressionAttributeValues: { ":v": version } }),
    }));
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
    throw e;
  }
  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [YDOC_UPDATES_TABLE]: items.slice(i, i + 25).map((it) => ({
          DeleteRequest: { Key: { pageId, seq: it.seq } },
        })),
      },
    }));
  }
}
