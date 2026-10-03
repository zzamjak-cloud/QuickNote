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

/**
 * 신규 행 멤버십 — 클라 applyCollabDbStructure 는 rowMembers(집합 CRDT)·rowPageOrder(순서)로 행을 표시한다.
 * rowMembers 가 비어 있으면 클라는 rowPageOrder 폴백을 쓰므로, 그때 멤버에 새 행만 넣으면 기존 행이 전부 비멤버로
 * 숨는다 → 비어 있지 않을 때만 멤버에 추가한다. rowPageOrder 는 끝에 append(중복 방지).
 */
function addRowMembership(root: Y.Map<unknown>, rowPageId: string): void {
  const members = root.get("rowMembers");
  if (members instanceof Y.Array && members.length > 0) pushIfAbsent(members as Y.Array<string>, rowPageId);
  let order = root.get("rowPageOrder");
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    root.set("rowPageOrder", order);
  }
  pushIfAbsent(order as Y.Array<string>, rowPageId);
}

/**
 * 룸 상태에 행 셀 set/delete(undefined) 를 적용한 update. newRow 면 같은 트랜잭션에서 행 멤버십도 추가한다.
 * 룸이 비었으면 null.
 */
export function buildRowCellsUpdate(
  state: Uint8Array,
  rowPageId: string,
  cells: Record<string, unknown>,
  opts: { newRow?: boolean } = {},
): Uint8Array | null {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const root = doc.getMap<unknown>(DB_ROOT_KEY);
  if (root.size === 0) return null;
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    const row = ensureMap(ensureMap(root, "rows"), rowPageId);
    for (const [columnId, value] of Object.entries(cells)) {
      if (value === undefined) row.delete(columnId);
      else row.set(columnId, jsonToY(value));
    }
    if (opts.newRow) addRowMembership(root, rowPageId);
  });
  return Y.encodeStateAsUpdate(doc, before);
}

/** @returns 룸에 기록했으면 "collab", 룸이 비어 Pages.dbCells 만으로 충분하면 "pages". */
export async function writeDbRowCells(
  ctx: McpContext,
  databaseId: string,
  rowPageId: string,
  cells: Record<string, unknown>,
  opts: { newRow?: boolean } = {},
): Promise<"collab" | "pages"> {
  if (!opts.newRow && Object.keys(cells).length === 0) return "pages";
  const room = dbRoomKey(ctx.collabRoomEpoch, databaseId);
  const update = buildRowCellsUpdate(await loadPageState(room), rowPageId, cells, opts);
  if (!update) return "pages";
  await appendPageUpdate(room, update);
  await broadcastRoomUpdate(room, update);
  return "collab";
}
