/** 에디터 컬럼 너비 클래스 계산 — Editor/DatabaseRowPage/DatabaseRowPeek 공용 */
export function getEditorColumnClass(opts: {
  fullWidth: boolean;
  hasPageComments: boolean;
  peek?: boolean;
}): string {
  if (opts.fullWidth) return "max-w-none px-4";
  if (opts.hasPageComments && !opts.peek) return "max-w-[1017px] pr-[256px]";
  return "max-w-[784px]";
}
