/** TipTap 표 행·열 순서 드래그 — 블록 드롭 UI·dropcursor 와 구분 */
export const QUICKNOTE_TABLE_REORDER_MIME = "application/x-quicknote-table-reorder";

export type TableReorderDragPayload = {
  kind: "row" | "col";
  /** 문서 내 table 노드 시작 위치 */
  tablePos: number;
  /** 드래그 시작 열 또는 행 인덱스 */
  from: number;
};

export const TABLE_REORDER_DRAG_BODY_CLASS = "quicknote-table-reorder-dragging";

export function setTableReorderDragData(dt: DataTransfer, payload: TableReorderDragPayload): void {
  dt.setData(QUICKNOTE_TABLE_REORDER_MIME, JSON.stringify(payload));
}

export function parseTableReorderDragData(dt: DataTransfer | null): TableReorderDragPayload | null {
  const raw = dt?.getData(QUICKNOTE_TABLE_REORDER_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<TableReorderDragPayload>;
    if (p.kind !== "row" && p.kind !== "col") return null;
    if (!Number.isInteger(p.tablePos) || p.tablePos! < 0) return null;
    if (!Number.isInteger(p.from) || p.from! < 0) return null;
    return { kind: p.kind, tablePos: p.tablePos!, from: p.from! };
  } catch {
    return null;
  }
}

/** dragover 단계에서 getData 가 비어 있을 수 있어 types 로 판별 */
export function isTableReorderDragEvent(dt: DataTransfer | null): boolean {
  if (!dt?.types) return false;
  const want = QUICKNOTE_TABLE_REORDER_MIME;
  for (let i = 0; i < dt.types.length; i += 1) {
    if (dt.types[i] === want) return true;
  }
  return false;
}
