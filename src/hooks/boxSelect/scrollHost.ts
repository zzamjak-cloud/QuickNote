/**
 * 박스 선택이 실제로 움직여야 할 스크롤 컨테이너를 찾는다.
 *
 * 메인 에디터의 `.qn-editor-body-scroll`은 직접 스크롤하지만, 피크의 bodyOnly
 * 에디터에서는 같은 래퍼가 비스크롤이고 바깥 `.overflow-y-auto`가 스크롤 권위다.
 */
export function resolveBoxSelectScrollHost(editorDom: HTMLElement): HTMLElement | null {
  const bodyHost = editorDom.closest<HTMLElement>(".qn-editor-body-scroll");
  if (bodyHost?.classList.contains("overflow-y-auto")) return bodyHost;

  return (
    editorDom.closest<HTMLElement>(".overflow-y-auto") ??
    bodyHost ??
    editorDom.closest<HTMLElement>("[data-qn-editor-column]") ??
    editorDom.parentElement
  );
}
