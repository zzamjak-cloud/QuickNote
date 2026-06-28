/** 에디터 컬럼 너비 클래스 계산 — Editor/DatabaseRowPage/DatabaseRowPeek 공용 */
export function getEditorColumnClass(opts: {
  fullWidth: boolean;
  hasPageComments: boolean;
  peek?: boolean;
  /** 모바일(<768)에서는 항상 전폭 + 좌우 패딩, 댓글 패널 예약폭(pr-256) 비활성 */
  isMobile?: boolean;
}): string {
  // 모바일: 고정폭/우측 댓글 예약폭은 좁은 화면을 깨뜨린다 → 전폭 + 패딩.
  if (opts.isMobile) return "max-w-none px-4";
  if (opts.fullWidth) return "max-w-none px-4";
  if (opts.hasPageComments && !opts.peek) return "max-w-[1017px] pr-[256px]";
  return "max-w-[784px]";
}
