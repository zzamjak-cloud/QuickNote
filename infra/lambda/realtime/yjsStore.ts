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

// 페이지의 머지된 현재 상태(스냅샷 + 미압축 update 로그)를 로드.
export async function loadPageState(pageId: string): Promise<Uint8Array> {
  const snap = await ddb.send(new GetCommand({ TableName: YDOC_TABLE, Key: { pageId } }));
  const base: Uint8Array[] = [];
  const stateB64 = snap.Item?.state as string | undefined;
  if (stateB64) base.push(new Uint8Array(Buffer.from(stateB64, "base64")));
  const log = await ddb.send(new QueryCommand({
    TableName: YDOC_UPDATES_TABLE,
    KeyConditionExpression: "pageId = :p",
    ExpressionAttributeValues: { ":p": pageId },
  }));
  for (const it of log.Items ?? []) base.push(new Uint8Array(Buffer.from(it.update as string, "base64")));
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

async function compactPage(pageId: string): Promise<void> {
  const merged = await loadPageState(pageId);
  await ddb.send(new PutCommand({
    TableName: YDOC_TABLE,
    Item: { pageId, state: Buffer.from(merged).toString("base64"), updatedAt: new Date().toISOString() },
  }));
  const log = await ddb.send(new QueryCommand({
    TableName: YDOC_UPDATES_TABLE, KeyConditionExpression: "pageId = :p",
    ExpressionAttributeValues: { ":p": pageId },
  }));
  const items = log.Items ?? [];
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
