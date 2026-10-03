// DB 구조(제목·컬럼) 쓰기 — 협업 DB 룸이 시드돼 있으면 columns 가 룸에서 권위라, 클라 dbStructureReconcile
// (reconcileById: 컬럼 = Y.Map, 각 최상위 키를 jsonToY)와 같은 표현으로 룸에 반영한 뒤 upsertDatabase 로 영속하고
// publishDatabaseChanged 로 구독 클라에 알린다.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as Y from "yjs";
import type { ColumnDef } from "../../../src/types/database";
import { jsonToY } from "../realtime/dbSeed";
import { upsertDatabase } from "../v5-resolvers/handlers/pageDatabase";
import { recordDatabaseHistory } from "../v5-resolvers/handlers/pageDatabase/history";
import type { McpContext } from "./context";
import { editDbRoom, readDbRoomRoot } from "./dbCollabWriter";
import { getItem } from "./ddb";
import { loadDatabaseRows, parseColumnDefs } from "./dbRows";
import { publishDatabase } from "./publish";

type Item = Record<string, unknown>;

export type ColumnPlan = { added: ColumnDef[]; updated: ColumnDef[]; removedIds: string[] };

/** 현재 컬럼 — 룸이 시드돼 있으면 룸(권위), 아니면 Databases 레코드. */
export async function currentColumns(ctx: McpContext, db: Item): Promise<ColumnDef[]> {
  const root = await readDbRoomRoot(ctx, String(db.id));
  const fromRoom = root && Array.isArray(root.columns) ? parseColumnDefs(root.columns) : [];
  return fromRoom.length > 0 ? fromRoom : parseColumnDefs(db.columns);
}

export function applyPlan(columns: ColumnDef[], plan: ColumnPlan): ColumnDef[] {
  const updated = new Map(plan.updated.map((c) => [c.id, c]));
  const removed = new Set(plan.removedIds);
  return [...columns.filter((c) => !removed.has(c.id)).map((c) => updated.get(c.id) ?? c), ...plan.added];
}

function columnMap(column: ColumnDef): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(column)) m.set(k, jsonToY(v));
  return m;
}

/** reconcileById 와 같은 연산: 갱신은 바뀐 최상위 키만 set, 추가는 push, 삭제는 id 로 제거. */
export function columnsMutation(plan: ColumnPlan) {
  return (root: Y.Map<unknown>): void => {
    let arr = root.get("columns");
    if (!(arr instanceof Y.Array)) {
      arr = new Y.Array<Y.Map<unknown>>();
      root.set("columns", arr);
    }
    const columns = arr as Y.Array<Y.Map<unknown>>;
    const updated = new Map(plan.updated.map((c) => [c.id, c]));
    const removed = new Set(plan.removedIds);
    for (let i = columns.length - 1; i >= 0; i -= 1) {
      const ym = columns.get(i);
      const id = ym instanceof Y.Map ? (ym.get("id") as string) : "";
      if (removed.has(id)) {
        columns.delete(i, 1);
        continue;
      }
      const next = updated.get(id);
      if (!next) continue;
      for (const [k, v] of Object.entries(next)) {
        const cur = ym.get(k);
        const plain = cur instanceof Y.AbstractType ? cur.toJSON() : cur;
        if (JSON.stringify(plain) !== JSON.stringify(v)) ym.set(k, jsonToY(v));
      }
      for (const k of [...ym.keys()]) if (!(k in next)) ym.delete(k);
    }
    columns.push(plan.added.map(columnMap));
  };
}

/**
 * upsertDatabase 는 updatedAt LWW 라 기존 이하 시각의 쓰기를 조용히 버린다(같은 ms 연속 호출·클라 시계가 앞선 경우).
 * 서버 쓰기가 유실되지 않게 기존 updatedAt 보다 최소 1ms 뒤 시각을 쓴다.
 */
export function nextUpdatedAt(existing: unknown, nowMs = Date.now()): string {
  const prev = typeof existing === "string" ? Date.parse(existing) : NaN;
  return new Date(Number.isFinite(prev) && prev >= nowMs ? prev + 1 : nowMs).toISOString();
}

/**
 * DB 룸이 시드돼 있으면 구조(columns·presets·panelState)는 룸이 권위다. Databases 레코드는 클라 materialize 로
 * 늦게 따라오므로, 저장·발행에 레코드 값을 그대로 실으면 수신 클라가 "더 새로운 원격 값"으로 받아
 * reconcileStructureIntoYDoc 으로 룸의 최신 컬럼을 지우거나 되돌린다. 저장 직전 룸 값을 읽어 덮는다.
 */
export async function roomStructureFields(ctx: McpContext, databaseId: string): Promise<Item> {
  const root = await readDbRoomRoot(ctx, databaseId);
  if (!root || !Array.isArray(root.columns) || root.columns.length === 0) return {};
  const out: Item = { columns: JSON.stringify(root.columns) };
  if (Array.isArray(root.presets)) out.presets = JSON.stringify(root.presets);
  if (root.panelState && typeof root.panelState === "object") out.panelState = JSON.stringify(root.panelState);
  return out;
}

/**
 * 부분 upsertDatabase + 발행. upsertDatabase 는 기존 레코드 위에 입력을 병합하므로 바꾸는 필드만 넘기고,
 * 룸이 있으면 구조 필드는 룸 값으로 덮는다(roomStructureFields) — 저장 결과와 발행 payload 가 룸과 같아진다.
 */
export async function saveDatabase(ctx: McpContext, db: Item, fields: Item): Promise<Item> {
  const room = await roomStructureFields(ctx, String(db.id));
  const latest = await getItem(ctx.doc, ctx.tables.Databases, { id: db.id });
  const saved = await upsertDatabase({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: {
      id: db.id,
      workspaceId: db.workspaceId,
      createdByMemberId: db.createdByMemberId ?? ctx.caller.memberId,
      ...fields,
      ...room,
      updatedAt: nextUpdatedAt(latest?.updatedAt),
    },
  });
  await publishDatabase(saved);
  return saved;
}

/**
 * 컬럼 변경을 룸(시드돼 있으면)과 Databases 에 반영. 룸이 있으면 저장 컬럼은 편집 후 룸 값(그 사이 다른 클라 편집 포함),
 * 없을 때만 처음 읽은 current 에 계획을 적용한 값을 쓴다.
 */
export async function writeColumns(ctx: McpContext, db: Item, current: ColumnDef[], plan: ColumnPlan, extra: Item = {}) {
  const writtenTo = await editDbRoom(ctx, String(db.id), columnsMutation(plan));
  const saved = await saveDatabase(ctx, db, { ...extra, columns: JSON.stringify(applyPlan(current, plan)) });
  return { saved, columns: parseColumnDefs(saved.columns), writtenTo };
}

/**
 * 컬럼 삭제 전 DB 버전 체크포인트(saveDatabaseVersion 과 같은 kind·rowPageOrder 포함). 컬럼은 현재(룸) 기준.
 * 행 순서는 상한 없이 끝까지 읽는다(프로젝션으로 행당 비용이 작다) — 잘린 rowPageOrder 로 복원하면 행이 빠진다.
 */
export async function recordDatabaseCheckpoint(ctx: McpContext, db: Item, columns: ColumnDef[]): Promise<void> {
  const rows = await loadDatabaseRows(ctx, db, {}, Number.POSITIVE_INFINITY);
  const snapshot = { ...db, columns: JSON.stringify(columns), rowPageOrder: rows.rows.map((r) => String(r.id)) };
  await recordDatabaseHistory({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    before: db, after: snapshot, kind: "database.checkpoint", force: true,
  });
}

/** 워크스페이스의 살아 있는 DB 제목(제목 중복 검사용). */
export async function workspaceDatabaseTitles(ctx: McpContext, workspaceId: string, exceptId = ""): Promise<string[]> {
  const titles: string[] = [];
  let lastKey: Item | undefined;
  do {
    const r = await ctx.doc.send(new QueryCommand({
      TableName: ctx.tables.Databases,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": workspaceId },
      ProjectionExpression: "id, title, deletedAt",
      ExclusiveStartKey: lastKey,
    }));
    for (const it of r.Items ?? []) if (!it.deletedAt && it.id !== exceptId) titles.push(String(it.title ?? ""));
    lastKey = r.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  return titles;
}

/** 클라 allocateUniqueDatabaseTitle: 빈 제목은 "새 데이터베이스", 겹치면 " (2)", " (3)" … */
export function allocateDatabaseTitle(taken: string[], preferred: string): string {
  const norm = (t: string) => t.trim() || "제목 없음";
  let base = norm(preferred);
  if (base === "제목 없음") base = "새 데이터베이스";
  const used = new Set(taken.map(norm));
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base} (${n})`;
  return candidate;
}
