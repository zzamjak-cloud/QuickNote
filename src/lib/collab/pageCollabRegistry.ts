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
