import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection, TableMap } from "@tiptap/pm/tables";

// 표에서 CellSelection 으로 연속된 여러 열을 선택했을 때, 선택 열들의 전체 너비를
// 열 개수로 균등 분배하는 헬퍼. prosemirror-tables 의 colwidth 셀 속성을 직접 갱신한다.

/** prosemirror-tables 의 컬럼 최소 너비 기본값과 동일. */
const CELL_MIN_WIDTH = 25;

type ColumnRange = {
  table: PMNode;
  tableStart: number;
  map: TableMap;
  left: number;
  right: number;
};

function resolveSelectedColumnRange(editor: Editor): ColumnRange | null {
  const sel = editor.state.selection;
  if (!(sel instanceof CellSelection)) return null;
  const $cell = sel.$anchorCell;
  const table = $cell.node(-1);
  if (!table || table.type.name !== "table") return null;
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(
    sel.$anchorCell.pos - tableStart,
    sel.$headCell.pos - tableStart,
  );
  return { table, tableStart, map, left: rect.left, right: rect.right };
}

/** 현재 CellSelection 이 가로지르는 열 개수(연속). 균등 너비 버튼 노출 판단에 사용. */
export function getSelectedColumnCount(editor: Editor): number {
  const range = resolveSelectedColumnRange(editor);
  if (!range) return 0;
  return range.right - range.left;
}

/**
 * 선택한 열들의 현재 렌더 너비 합을 열 개수로 나눠 각 열에 균등 분배한다.
 * 현재 너비는 실제 DOM 셀 폭에서 측정 — 사용자가 컬럼 라인을 드래그해 바꾼 너비를 그대로 반영.
 */
export function distributeSelectedColumnsEvenly(editor: Editor): boolean {
  const range = resolveSelectedColumnRange(editor);
  if (!range) return false;
  const { table, tableStart, map, left, right } = range;
  const colCount = right - left;
  if (colCount < 2) return false;

  const view = editor.view;

  // 각 선택 열의 첫 행 셀 DOM 폭을 측정해 합산.
  let total = 0;
  for (let col = left; col < right; col++) {
    const relCellPos = map.map[col]; // 0번째 행 × col
    if (relCellPos == null) continue;
    const dom = view.nodeDOM(tableStart + relCellPos);
    const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
    if (el) total += el.getBoundingClientRect().width;
  }
  if (total <= 0) return false;

  const equal = Math.max(CELL_MIN_WIDTH, Math.round(total / colCount));

  // 선택 열에 속한 모든 셀의 colwidth 를 균등값으로 설정.
  const tr = editor.state.tr;
  const seen = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    for (let col = left; col < right; col++) {
      const relCellPos = map.map[row * map.width + col];
      if (relCellPos == null || seen.has(relCellPos)) continue;
      seen.add(relCellPos);
      const cell = table.nodeAt(relCellPos);
      if (!cell) continue;
      const colspan = (cell.attrs.colspan as number) || 1;
      const newColwidth = Array.from({ length: colspan }, () => equal);
      tr.setNodeMarkup(tableStart + relCellPos, undefined, {
        ...cell.attrs,
        colwidth: newColwidth,
      });
    }
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}
