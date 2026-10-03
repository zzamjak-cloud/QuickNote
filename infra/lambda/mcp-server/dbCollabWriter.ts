// DB 행 셀 쓰기(Yjs 경로) — 협업 DB 룸(`db:<epoch>:<dbId>`)의 rows 맵이 셀 권위다.
// 룸이 시드돼 있으면 page.dbCells 만 바꿔도 열린 DB 뷰의 materialize 가 옛 셀로 되돌리므로
// 클라 writeCellsToCollabDoc(src/lib/collab/dbCellsCollab.ts)과 같은 구조로 룸에도 기록한다.
// 룸이 비어 있으면(아직 아무도 연 적 없음) 첫 진입 시 서버 dbSeed 가 Pages.dbCells 로 시드하므로 룸은 건드리지 않는다.
import * as Y from "yjs";
import { jsonToY } from "../realtime/dbSeed";
import { appendPageUpdate, loadPageState } from "../realtime/yjsStore";
import type { McpContext } from "./context";
import { broadcastRoomUpdate } from "./wsBroadcast";

/** 클라 dbBundleYjs.DB_ROOT_KEY 와 동일. */
const DB_ROOT_KEY = "db";

export function dbRoomKey(epoch: string, databaseId: string): string {
  return `db:${epoch}:${databaseId}`;
}

function ensureMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) return existing as Y.Map<unknown>;
  const created = new Y.Map<unknown>();
  parent.set(key, created);
  return created;
}

function pushIfAbsent(arr: Y.Array<string>, id: string): void {
  if (!arr.toArray().includes(id)) arr.push([id]);
}

function removeAll(arr: unknown, id: string): void {
  if (!(arr instanceof Y.Array)) return;
  for (let i = arr.length - 1; i >= 0; i -= 1) if (arr.get(i) === id) arr.delete(i, 1);
}

/**
 * 신규 행 멤버십 — 클라 applyCollabDbStructure 는 rowMembers(집합 CRDT)·rowPageOrder(순서)로 행을 표시한다.
 * rowMembers 가 비어 있으면 클라는 rowPageOrder 폴백을 쓰므로, 그때 멤버에 새 행만 넣으면 기존 행이 전부 비멤버로
 * 숨는다 → 비어 있지 않을 때만 멤버에 추가한다. rowPageOrder 는 after 행 바로 뒤(없으면 끝)에 넣는다(중복 방지).
 */
function addRowMembership(root: Y.Map<unknown>, rowPageId: string, after?: string): void {
  const members = root.get("rowMembers");
  if (members instanceof Y.Array && members.length > 0) pushIfAbsent(members as Y.Array<string>, rowPageId);
  let order = root.get("rowPageOrder");
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    root.set("rowPageOrder", order);
  }
  const arr = order as Y.Array<string>;
  if (arr.toArray().includes(rowPageId)) return;
  const anchor = after ? arr.toArray().indexOf(after) : -1;
  if (anchor >= 0) arr.insert(anchor + 1, [rowPageId]);
  else arr.push([rowPageId]);
}

/** 시드된 룸에만 mutate 를 한 트랜잭션으로 적용한 update. 룸이 비었으면 null. */
export function buildDbRoomUpdate(state: Uint8Array, mutate: (root: Y.Map<unknown>) => void): Uint8Array | null {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const root = doc.getMap<unknown>(DB_ROOT_KEY);
  if (root.size === 0) return null;
  const before = Y.encodeStateVector(doc);
  doc.transact(() => mutate(root));
  return Y.encodeStateAsUpdate(doc, before);
}

/** 룸 상태를 읽어(read) 편집(mutate)을 반영·저장·브로드캐스트. 룸이 비면 "pages"(Pages/Databases 저장만으로 충분). */
export async function editDbRoom(
  ctx: McpContext,
  databaseId: string,
  mutate: (root: Y.Map<unknown>) => void,
): Promise<"collab" | "pages"> {
  const room = dbRoomKey(ctx.collabRoomEpoch, databaseId);
  const update = buildDbRoomUpdate(await loadPageState(room), mutate);
  if (!update) return "pages";
  await appendPageUpdate(room, update);
  await broadcastRoomUpdate(room, update);
  return "collab";
}

/** 룸의 현재 DB 구조(JSON). 룸이 비면 null — 호출자는 Databases 레코드를 쓴다. */
export async function readDbRoomRoot(ctx: McpContext, databaseId: string): Promise<Record<string, unknown> | null> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await loadPageState(dbRoomKey(ctx.collabRoomEpoch, databaseId)));
  const root = doc.getMap<unknown>(DB_ROOT_KEY);
  return root.size === 0 ? null : (root.toJSON() as Record<string, unknown>);
}

export type RowWriteOptions = { newRow?: boolean; after?: string };

/** 행 셀 set/delete(undefined). newRow 면 같은 트랜잭션에서 행 멤버십도 추가한다. */
function rowCellsMutation(rowPageId: string, cells: Record<string, unknown>, opts: RowWriteOptions) {
  return (root: Y.Map<unknown>): void => {
    const row = ensureMap(ensureMap(root, "rows"), rowPageId);
    for (const [columnId, value] of Object.entries(cells)) {
      if (value === undefined) row.delete(columnId);
      else row.set(columnId, jsonToY(value));
    }
    if (opts.newRow) addRowMembership(root, rowPageId, opts.after);
  };
}

/** 룸이 비었으면 null. */
export function buildRowCellsUpdate(
  state: Uint8Array,
  rowPageId: string,
  cells: Record<string, unknown>,
  opts: RowWriteOptions = {},
): Uint8Array | null {
  return buildDbRoomUpdate(state, rowCellsMutation(rowPageId, cells, opts));
}

/** @returns 룸에 기록했으면 "collab", 룸이 비어 Pages.dbCells 만으로 충분하면 "pages". */
export async function writeDbRowCells(
  ctx: McpContext,
  databaseId: string,
  rowPageId: string,
  cells: Record<string, unknown>,
  opts: RowWriteOptions = {},
): Promise<"collab" | "pages"> {
  if (!opts.newRow && Object.keys(cells).length === 0) return "pages";
  return editDbRoom(ctx, databaseId, rowCellsMutation(rowPageId, cells, opts));
}

/**
 * 행 제거(휴지통) — 클라 deleteRow 는 rows 엔트리 삭제(deleteRowFromCollabDoc) + 로컬 순서에서 제외 후 reconcile 로
 * rowMembers 에서 빠진다. 서버는 같은 결과를 한 트랜잭션으로 만든다. 이걸 안 하면 materialize 가 유령 행을 되살린다.
 */
export function removeDbRow(ctx: McpContext, databaseId: string, rowPageId: string): Promise<"collab" | "pages"> {
  return editDbRoom(ctx, databaseId, (root) => {
    const rows = root.get("rows");
    if (rows instanceof Y.Map) rows.delete(rowPageId);
    removeAll(root.get("rowMembers"), rowPageId);
    removeAll(root.get("rowPageOrder"), rowPageId);
  });
}
