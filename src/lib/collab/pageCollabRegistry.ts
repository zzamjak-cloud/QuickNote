// 협업 ON 페이지의 활성 세션. 세션이 열려 있는 동안 본문(doc) 권위가 Y.Doc 이므로,
// 동기화 경로(storeApply)가 stale 한 REST page.doc echo 로 store.doc 를 덮지 않도록 판정에 쓴다.
// 또한 버전 복원처럼 본문을 명시적으로 교체해야 할 때, 활성 세션의 Y.Doc 본문을 직접 갈아끼우기
// 위한 콜백(Editor 가 schema 와 함께 등록)을 보관한다 — preserveCollabDoc 가 복원 doc 을 버려도
// Y룸 권위를 복원본으로 갱신해 화면·피어에 반영되게 한다.
import type { JSONContent } from "@tiptap/core";

type PageCollabEntry = {
  replaceBody?: (json: JSONContent) => void;
};

const activePages = new Map<string, PageCollabEntry>();

export function registerPageCollab(pageId: string): void {
  if (!activePages.has(pageId)) activePages.set(pageId, {});
}
export function unregisterPageCollab(pageId: string): void {
  activePages.delete(pageId);
}
/** 해당 페이지에 현재 이 클라이언트의 협업 세션이 열려 있는가(=Y.Doc 가 본문 권위). */
export function isPageCollabActive(pageId: string): boolean {
  return activePages.has(pageId);
}

/** Editor 가 바인딩 후 본문 교체 콜백을 등록한다. */
export function setPageCollabReplaceBody(
  pageId: string,
  fn: (json: JSONContent) => void,
): void {
  const entry = activePages.get(pageId);
  if (entry) entry.replaceBody = fn;
}

/**
 * 활성 세션의 Y.Doc 본문을 json 으로 교체한다(버전 복원용).
 * @returns 콜백이 등록돼 교체했으면 true, 세션 미오픈/콜백 없음이면 false.
 */
export function replacePageCollabBody(pageId: string, json: JSONContent): boolean {
  const fn = activePages.get(pageId)?.replaceBody;
  if (!fn) return false;
  fn(json);
  return true;
}
