import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

// 표 헤더행/헤더열 상태 판별 및 토글 헬퍼.
// TipTap toggleHeaderRow/Column 명령이 셀렉션 위치·확장 등록 상태에 따라 실패할 수 있어
// PM 트랜잭션으로 직접 처리한다. TableBlockControls 의 행/열 그립 메뉴와 BlockHandles 의
// 표 블록 핸들 메뉴가 동일 로직을 공유한다.

export function isHeaderRowActive(table: PMNode): boolean {
  const firstRow = table.maybeChild(0);
  if (!firstRow || firstRow.childCount === 0) return false;
  for (let i = 0; i < firstRow.childCount; i++) {
    if (firstRow.child(i).type.name !== "tableHeader") return false;
  }
  return true;
}

export function isHeaderColActive(table: PMNode): boolean {
  if (table.childCount < 2) return false;
  return table.child(1).maybeChild(0)?.type.name === "tableHeader";
}

/**
 * 첫 행의 셀들을 tableHeader↔tableCell 로 직접 변환한다.
 */
export function applyHeaderRowToggle(editor: Editor, tablePos: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const firstRow = table.maybeChild(0);
  if (!firstRow) return false;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  if (!headerType || !cellType) return false;
  const deactivating = isHeaderRowActive(table);
  const targetType = deactivating ? cellType : headerType;
  const headerColActive = isHeaderColActive(table);
  const newCells: PMNode[] = [];
  firstRow.forEach((cell, _o, i) => {
    // 헤더행 비활성화 시, 헤더열이 활성화된 상태라면 첫 셀은 헤더열 타입 유지
    if (deactivating && headerColActive && i === 0) {
      newCells.push(headerType.createChecked(cell.attrs, cell.content, cell.marks));
    } else {
      newCells.push(targetType.createChecked(cell.attrs, cell.content, cell.marks));
    }
  });
  const newRow = firstRow.type.createChecked(firstRow.attrs, newCells, firstRow.marks);
  const rowFrom = tablePos + 1; // 테이블 노드 진입 후 첫 자식
  const rowTo = rowFrom + firstRow.nodeSize;
  editor.view.dispatch(state.tr.replaceWith(rowFrom, rowTo, newRow));
  return true;
}

/** 각 행의 첫 셀을 tableHeader↔tableCell 로 직접 변환 — 테이블 전체 재생성 트랜잭션. */
export function applyHeaderColToggle(editor: Editor, tablePos: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  if (!headerType || !cellType) return false;
  const deactivating = isHeaderColActive(table);
  const targetType = deactivating ? cellType : headerType;
  const headerRowActive = isHeaderRowActive(table);
  const newRows: PMNode[] = [];
  table.forEach((row, _o, rowIdx) => {
    const newCells: PMNode[] = [];
    row.forEach((cell, _offset, i) => {
      if (i === 0) {
        // 헤더열 비활성화 시, 헤더행이 활성화된 상태라면 첫 행의 첫 셀은 헤더행 타입 유지
        if (deactivating && headerRowActive && rowIdx === 0) {
          newCells.push(headerType.createChecked(cell.attrs, cell.content, cell.marks));
        } else {
          newCells.push(targetType.createChecked(cell.attrs, cell.content, cell.marks));
        }
      } else {
        newCells.push(cell);
      }
    });
    newRows.push(row.type.createChecked(row.attrs, newCells, row.marks));
  });
  const newTable = table.type.createChecked(table.attrs, newRows, table.marks);
  editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable));
  return true;
}
