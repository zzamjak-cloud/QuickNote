// 협업 ON DB 의 행 셀 값을 Y.Doc 의 rows 맵에 쓰는 단일 헬퍼.
// rows: Y.Map(rowPageId → Y.Map(columnId → 셀 값 JSON)). 셀 값은 통째 set(atomic LWW).
import * as Y from "yjs";
import { DB_ROOT_KEY, jsonToY, type Json } from "./dbBundleYjs";
import { getDbCollab } from "./dbCollabRegistry";

/**
 * databaseId 가 협업 활성이면 pageId 행의 셀들을 Y.Doc rows 맵에 반영한다.
 * - cells 의 각 columnId 를 set(값) 또는 delete(값이 undefined).
 * - 협업 비활성(핸들 없음)이면 아무것도 하지 않고 false 반환 → 호출부가 기존 LWW 경로로 폴백.
 * @returns Y 로 라우팅했으면 true, 협업 비활성이면 false.
 */
export function writeCellsToCollabDoc(
  databaseId: string,
  pageId: string,
  cells: Record<string, unknown>,
): boolean {
  const handle = getDbCollab(databaseId);
  if (!handle) return false;
  const root = handle.doc.getMap(DB_ROOT_KEY);
  handle.doc.transact(() => {
    let rows = root.get("rows");
    if (!(rows instanceof Y.Map)) {
      rows = new Y.Map<unknown>();
      root.set("rows", rows);
    }
    const rowsMap = rows as Y.Map<unknown>;
    let row = rowsMap.get(pageId);
    if (!(row instanceof Y.Map)) {
      row = new Y.Map<unknown>();
      rowsMap.set(pageId, row);
    }
    const rowMap = row as Y.Map<unknown>;
    for (const [columnId, value] of Object.entries(cells)) {
      if (value === undefined) rowMap.delete(columnId);
      else rowMap.set(columnId, jsonToY(value as Json));
    }
  });
  return true;
}

/**
 * databaseId 가 협업 활성이면 pageId 행 자체를 Y.Doc rows 맵에서 제거한다.
 * 행 삭제/행→일반페이지 전환처럼 "행이 더 이상 이 DB 소속이 아닐 때" 호출 — 이걸 안 하면
 * materialize 가 Y룸의 남은 행을 store 로 되살려 유령 행이 된다.
 * @returns Y 에서 제거했으면 true, 협업 비활성이면 false.
 */
export function deleteRowFromCollabDoc(databaseId: string, pageId: string): boolean {
  const handle = getDbCollab(databaseId);
  if (!handle) return false;
  const root = handle.doc.getMap(DB_ROOT_KEY);
  handle.doc.transact(() => {
    const rows = root.get("rows");
    if (rows instanceof Y.Map) rows.delete(pageId);
  });
  return true;
}

/**
 * 버전 복원용 — pageId 행의 셀을 복원본 `cells` 와 **정확히 일치**하도록 DB Y룸(권위)에 덮어쓴다.
 * writeCellsToCollabDoc 는 전달된 키만 set/delete 하므로 복원본에 없는 기존 셀이 남는다.
 * 이 함수는 복원본에 없는 기존 셀까지 삭제해, 그 버전 시점의 셀 상태로 완전히 되돌린다.
 * 협업 활성(핸들 존재)일 때만 동작 — Y룸이 셀 권위라, 이걸 안 하면 materialize 가 옛 셀로 되돌린다.
 * @returns Y 로 반영했으면 true, 협업 비활성이면 false(호출부가 store/LWW 경로로 폴백).
 */
export function restoreRowCellsToCollabDoc(
  databaseId: string,
  pageId: string,
  cells: Record<string, unknown>,
): boolean {
  const handle = getDbCollab(databaseId);
  if (!handle) return false;
  const root = handle.doc.getMap(DB_ROOT_KEY);
  handle.doc.transact(() => {
    let rows = root.get("rows");
    if (!(rows instanceof Y.Map)) {
      rows = new Y.Map<unknown>();
      root.set("rows", rows);
    }
    const rowsMap = rows as Y.Map<unknown>;
    let row = rowsMap.get(pageId);
    if (!(row instanceof Y.Map)) {
      row = new Y.Map<unknown>();
      rowsMap.set(pageId, row);
    }
    const rowMap = row as Y.Map<unknown>;
    // 복원본에 없는 기존 셀은 삭제(그 시점 상태로 정확히 복원).
    for (const columnId of Array.from(rowMap.keys())) {
      if (!(columnId in cells)) rowMap.delete(columnId);
    }
    for (const [columnId, value] of Object.entries(cells)) {
      if (value === undefined) rowMap.delete(columnId);
      else rowMap.set(columnId, jsonToY(value as Json));
    }
  });
  return true;
}
