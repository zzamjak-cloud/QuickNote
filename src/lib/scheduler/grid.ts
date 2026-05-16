// LC 스케줄러 연간 그리드 픽셀·줌 상수.
export const DEFAULT_CELL_WIDTH = 50;
export const DEFAULT_CELL_HEIGHT = 56;
export const CARD_MARGIN = 2;
export const ROW_PADDING_TOP = 6;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.0;
export const ZOOM_STEP = 0.25;

export const MIN_COLUMN_SCALE = 0.6;
export const MAX_COLUMN_SCALE = 2.0;
export const COLUMN_SCALE_STEP = 0.1;

// 멤버 행에 동시에 표시할 수 있는 카드 수(rowIndex 0..N-1) — 행 높이 계산용
// 최솟값 56px 보장: 좌측 멤버 셀과 우측 타임라인 행이 동일한 픽셀 높이를 공유
export function getRowHeight(rowCount: number, zoom: number): number {
  const base = DEFAULT_CELL_HEIGHT * Math.max(0.5, zoom);
  return Math.max(56, base, base * Math.max(1, rowCount));
}

export function getCellWidth(zoom: number, columnScale: number): number {
  return DEFAULT_CELL_WIDTH * zoom * columnScale;
}
