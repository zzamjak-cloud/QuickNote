// 협업 ON 페이지의 활성 세션 집합. 세션이 열려 있는 동안에는 본문(doc) 권위가 Y.Doc 이므로,
// 동기화 경로(storeApply)가 stale 한 REST page.doc echo 로 store.doc 를 덮지 않도록 판정에 쓴다.
const activePageIds = new Set<string>();

export function registerPageCollab(pageId: string): void {
  activePageIds.add(pageId);
}
export function unregisterPageCollab(pageId: string): void {
  activePageIds.delete(pageId);
}
/** 해당 페이지에 현재 이 클라이언트의 협업 세션이 열려 있는가(=Y.Doc 가 본문 권위). */
export function isPageCollabActive(pageId: string): boolean {
  return activePageIds.has(pageId);
}

// 버전 복원 시 협업 활성 페이지의 본문을 복원본으로 재시드(언바인딩→Y룸 교체→재바인딩)하기 위해
// Editor 가 등록하는 핸들러. 바인딩된 Y.Doc 을 외부에서 직접 교체하면 ProseMirror 뷰가 갱신되지
// 않으므로, Editor 가 collabBoundDoc 을 풀어 재시드 경로로 교체를 처리해야 한다.
type PageBodyRestoreHandler = (restoredDocJson: unknown) => void;
const restoreHandlers = new Map<string, PageBodyRestoreHandler>();

/** Editor 가 자신이 연 페이지의 본문 복원 핸들러를 등록. 반환값은 해제 함수. */
export function registerPageRestoreHandler(
  pageId: string,
  handler: PageBodyRestoreHandler,
): () => void {
  restoreHandlers.set(pageId, handler);
  return () => {
    if (restoreHandlers.get(pageId) === handler) restoreHandlers.delete(pageId);
  };
}

/**
 * 협업 활성 페이지의 본문 복원 요청. 핸들러(열려 있는 Editor)가 있으면 호출 후 true,
 * 없으면 false → 호출부는 store 주입 경로(비협업)로 폴백한다.
 */
export function requestPageBodyRestore(pageId: string, restoredDocJson: unknown): boolean {
  const handler = restoreHandlers.get(pageId);
  if (!handler) return false;
  handler(restoredDocJson);
  return true;
}
