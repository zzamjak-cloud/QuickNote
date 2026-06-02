import type { SearchHitTarget } from "./editorNavigationBridge";

/**
 * 검색 결과 클릭 시: 페이지를 먼저 전환하고, 이동 대상(query + 블록 좌표)을 여기에 저장한다.
 * 새 페이지의 Editor 가 본문 하이드레이션을 끝낸 뒤 consume 해서 스크롤+하이라이트한다.
 */
export type PendingNavigation = {
  pageId: string;
  target: SearchHitTarget;
};

let pending: PendingNavigation | null = null;

export function setPendingNavigation(next: PendingNavigation): void {
  pending = next;
}

export function peekPendingNavigation(): PendingNavigation | null {
  return pending;
}

export function consumePendingNavigation(): PendingNavigation | null {
  const value = pending;
  pending = null;
  return value;
}
