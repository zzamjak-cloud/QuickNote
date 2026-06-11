import * as Y from "yjs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DATABASE_TABLE = process.env.DATABASE_TABLE!;
const DB_ROOT_KEY = "db";

// AWSJSON 문자열 안전 파싱.
function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

// JSON → Y 깊은 변환(클라 dbBundleYjs 와 동일 규칙).
function jsonToY(value: unknown): unknown {
  if (Array.isArray(value)) { const a = new Y.Array(); a.push(value.map(jsonToY)); return a; }
  if (value !== null && typeof value === "object") {
    const m = new Y.Map(); for (const [k, v] of Object.entries(value)) m.set(k, jsonToY(v)); return m;
  }
  return value;
}

/** databaseId 의 현재 Database 항목에서 구조를 읽어 Y.Doc 시드 update 를 만든다. 없으면 null. */
export async function buildDbSeedUpdate(databaseId: string): Promise<Uint8Array | null> {
  const res = await ddb.send(new GetCommand({ TableName: DATABASE_TABLE, Key: { id: databaseId } }));
  const item = res.Item;
  if (!item) return null;
  const doc = new Y.Doc();
  const root = doc.getMap(DB_ROOT_KEY);
  doc.transact(() => {
    root.set("columns", jsonToY(parseJson(item.columns, [])));
    root.set("presets", jsonToY(parseJson(item.presets, [])));
    root.set("panelState", jsonToY(parseJson(item.panelState, {})));
    root.set("rowPageOrder", jsonToY(parseJson(item.rowPageOrder, [])));
  });
  return Y.encodeStateAsUpdate(doc);
}
