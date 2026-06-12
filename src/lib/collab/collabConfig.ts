// 실시간 협업 feature flag 및 WebSocket URL 빌더.
// Phase 1 은 기본 OFF. VITE_COLLAB_WS_URL 이 설정되고 페이지가 allowlist 에 포함될 때만 활성.
// build-marker: 2026-06-13 #9 — 데스크톱 빌드 협업 ON 합류 + epoch v3→v4(stale 룸 격리).

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

/**
 * 협업 룸·로컬 영속(IndexedDB) 키 세대(epoch).
 * 협업을 껐다 다시 켤 때(OFF→ON)는 반드시 이 값을 올린다 — 서버 룸 Y 상태와 각 브라우저의
 * IndexedDB 잔재가 모두 새 세대로 격리되어, stale 상태가 최신 본문을 되돌리는 사고를 차단한다.
 */
export function collabRoomEpoch(): string {
  // v3→v4: 데스크톱 협업 합류 시점. 데스크톱이 협업 OFF 였던 기간에 REST page.doc 으로만
  // 갱신된 본문이 stale v3 룸에 가려지던 사고를 차단한다. 세대 전환 시 빈 v4 룸이
  // 서버 page.doc(최신)으로 재시드된다. 웹(Vercel)·데스크톱(빌드) env 를 동시에 v4 로 맞출 것.
  return (import.meta.env.VITE_COLLAB_ROOM_EPOCH as string | undefined)?.trim() || "v4";
}

/** $connect 쿼리스트링(token·pageId)을 붙인 최종 WS URL. room 은 epoch 솔트를 포함한다. */
export function buildCollabWsUrl(pageId: string, token: string): string {
  const base = wsBase();
  const sep = base.includes("?") ? "&" : "?";
  const room = `${collabRoomEpoch()}:${pageId}`;
  return `${base}${sep}token=${encodeURIComponent(token)}&pageId=${encodeURIComponent(room)}`;
}

/** 협업 허용 databaseId 목록. 콤마 구분. "*" 이면 전체 허용. */
function enabledDatabaseIds(): string[] {
  const raw = (import.meta.env.VITE_COLLAB_ENABLED_DB_IDS as string | undefined) ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 해당 DB 에서 구조 실시간 협업을 활성화할지 여부. */
export function isCollabEnabledForDatabase(databaseId: string | null | undefined): boolean {
  if (!databaseId) return false;
  if (!wsBase()) return false;
  const list = enabledDatabaseIds();
  if (list.includes("*")) return true;
  return list.includes(databaseId);
}

/** DB room($connect)용 WS URL. room 식별자는 pageId 파라미터에 "db:<epoch>:<id>" 로 싣는다. */
export function buildDbCollabWsUrl(databaseId: string, token: string): string {
  const base = wsBase();
  const sep = base.includes("?") ? "&" : "?";
  const room = `db:${collabRoomEpoch()}:${databaseId}`;
  return `${base}${sep}token=${encodeURIComponent(token)}&pageId=${encodeURIComponent(room)}`;
}
