import * as Y from "yjs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DATABASE_TABLE = process.env.DATABASE_TABLE!;
const PAGE_TABLE = process.env.PAGE_TABLE!;
const DB_ROOT_KEY = "db";
// 서버 rows 시드 행 수 상한. 초과 시 rows 시드 생략(클라가 보충).
const MAX_SEED_ROWS = 1000;

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

// 행 페이지의 dbCells 를 조회해 rows 맵(rowPageId → cells)으로 모은다.
// 존재하는 모든 행에 inner map 을 시드한다(셀이 비어도 {}) → 모든 기존 행의 inner Y.Map 이
// 공유 상태로 존재하므로 다른-셀 동시편집이 필드 단위로 병합된다.
// 행 수가 상한을 넘으면 빈 객체 반환(클라 시드 폴백).
async function loadRowsCells(rowPageOrder: string[]): Promise<Record<string, Record<string, unknown>>> {
  if (rowPageOrder.length === 0 || rowPageOrder.length > MAX_SEED_ROWS) {
    if (rowPageOrder.length > MAX_SEED_ROWS) {
      console.warn("[dbSeed] rows 시드 생략: 행 수 상한 초과", { count: rowPageOrder.length, cap: MAX_SEED_ROWS });
    }
    return {};
  }
  const rows: Record<string, Record<string, unknown>> = {};
  // 동시 GetItem(병렬). 100개씩 청크로 호출량 제어.
  const CHUNK = 100;
  for (let i = 0; i < rowPageOrder.length; i += CHUNK) {
    const chunk = rowPageOrder.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map((pageId) =>
        ddb.send(new GetCommand({ TableName: PAGE_TABLE, Key: { id: pageId } }))
          .then((r) => ({ pageId, item: r.Item }))
          .catch(() => ({ pageId, item: undefined as Record<string, unknown> | undefined })),
      ),
    );
    for (const { pageId, item } of results) {
      if (!item) continue;
      // 셀이 비어도 inner map 을 시드한다(병합 보장).
      rows[pageId] = parseJson<Record<string, unknown>>(item.dbCells, {});
    }
  }
  return rows;
}

/** databaseId 의 현재 Database 항목 + 행 셀로 Y.Doc 시드 update 를 만든다. 없으면 null. */
export async function buildDbSeedUpdate(databaseId: string): Promise<Uint8Array | null> {
  const res = await ddb.send(new GetCommand({ TableName: DATABASE_TABLE, Key: { id: databaseId } }));
  const item = res.Item;
  if (!item) return null;
  const rowPageOrder = parseJson<string[]>(item.rowPageOrder, []);
  const rows = await loadRowsCells(rowPageOrder);
  const doc = new Y.Doc();
  const root = doc.getMap(DB_ROOT_KEY);
  doc.transact(() => {
    root.set("columns", jsonToY(parseJson(item.columns, [])));
    root.set("presets", jsonToY(parseJson(item.presets, [])));
    root.set("panelState", jsonToY(parseJson(item.panelState, {})));
    root.set("rowPageOrder", jsonToY(rowPageOrder));
    root.set("rows", jsonToY(rows));
    root.set("rowMembers", jsonToY(rowPageOrder));
  });
  return Y.encodeStateAsUpdate(doc);
}
