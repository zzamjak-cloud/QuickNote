import type { Page } from "../types/page";

/**
 * 교차 워크스페이스 멘션/링크 검색의 워크스페이스별 후보 페이지 캐시(세션 메모리).
 * TTL·로드 로직은 crossWorkspaceSearch 가 관리하고, 이 모듈은 Map 과 삽입 헬퍼만 보유한다.
 * pageStore 등에서 순환 import 없이 쓰도록 별도 모듈로 분리했다(타입만 의존).
 */
export const crossWorkspacePageCache = new Map<
  string,
  { loadedAt: number; pages: Page[] }
>();

/**
 * 새로 만든 페이지를 해당 워크스페이스의 후보 캐시에 즉시 반영한다(네트워크 없음).
 * 캐시 엔트리가 없으면(아직 그 워크스페이스를 교차 검색한 적 없음) 다음 검색이 fresh 페치로
 * 새 페이지를 포함하므로 아무것도 하지 않는다. 세션별 캐시라 같은 클라이언트의 후속 교차 검색에만
 * 즉시 반영된다(다른 사용자/기기는 자기 TTL 만료 시 반영).
 */
export function insertPageIntoCrossWorkspaceCache(page: Page): void {
  if (!page.workspaceId) return;
  const cached = crossWorkspacePageCache.get(page.workspaceId);
  if (!cached) return;
  if (cached.pages.some((p) => p.id === page.id)) return;
  cached.pages = [...cached.pages, page];
}
