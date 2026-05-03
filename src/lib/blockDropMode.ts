/**
 * 블록 드래그 시 드롭 모드 단일 결정 헬퍼.
 *
 * 마우스 X좌표가 타깃 블록 bounding rect 의 좌·우 가장자리 영역(edgeRatio 비율)에 있으면
 * 컬럼 분할 모드, 그 외 영역은 리스트(수직 형제) 이동 모드로 단일 결정한다.
 *
 * 이렇게 모드를 단일화함으로써 가로 점선(컬럼 인디케이터)과 세로 점선(리스트 dropcursor)이
 * 동시에 표시되던 문제를 차단한다.
 */
export type BlockDropMode = "column-left" | "column-right" | "list";

export function decideDropMode(
  rectLeft: number,
  rectWidth: number,
  clientX: number,
  edgeRatio = 0.2,
): BlockDropMode {
  if (rectWidth <= 0) return "list";
  const ratio = Math.min(Math.max(edgeRatio, 0), 0.5);
  const pct = (clientX - rectLeft) / rectWidth;
  if (pct < ratio) return "column-left";
  if (pct > 1 - ratio) return "column-right";
  return "list";
}
