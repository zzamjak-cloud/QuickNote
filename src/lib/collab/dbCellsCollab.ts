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
