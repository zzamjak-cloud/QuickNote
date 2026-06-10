// 실시간 협업 feature flag 및 WebSocket URL 빌더.
// Phase 1 은 기본 OFF. VITE_COLLAB_WS_URL 이 설정되고 페이지가 allowlist 에 포함될 때만 활성.

/** 협업 WS 베이스 URL(없으면 협업 전체 비활성). 예: wss://abc.execute-api.ap-northeast-2.amazonaws.com/dev */
function wsBase(): string {
  return (import.meta.env.VITE_COLLAB_WS_URL as string | undefined)?.trim() ?? "";
}

/** 협업 허용 pageId 목록. 콤마 구분. "*" 이면 전체 허용. */
function enabledPageIds(): string[] {
  const raw = (import.meta.env.VITE_COLLAB_ENABLED_PAGE_IDS as string | undefined) ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 해당 페이지에서 실시간 협업을 활성화할지 여부. */
export function isCollabEnabledForPage(pageId: string | null | undefined): boolean {
  if (!pageId) return false;
  if (!wsBase()) return false;
  const list = enabledPageIds();
  if (list.includes("*")) return true;
  return list.includes(pageId);
}

/** $connect 쿼리스트링(token·pageId)을 붙인 최종 WS URL. */
export function buildCollabWsUrl(pageId: string, token: string): string {
  const base = wsBase();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}&pageId=${encodeURIComponent(pageId)}`;
}
