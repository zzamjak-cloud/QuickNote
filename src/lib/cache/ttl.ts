// 캐시 TTL 중앙 정의 — 여러 곳에 흩어진 마법 숫자를 한 곳에서 관리.
//
// 가이드라인:
// - 새 캐시 정책 추가 시 여기에 상수를 정의하고 inline 마법 숫자 금지.
// - TTL 의미: "이 시간이 지나면 캐시를 신선하지 않다고 본다"
// - 단위: ms

/** 1초(ms) */
const SECOND = 1000;
/** 1분(ms) */
const MINUTE = 60 * SECOND;
/** 1시간(ms) */
const HOUR = 60 * MINUTE;
/** 1일(ms) */
const DAY = 24 * HOUR;

export const CACHE_TTL = {
  /** 팀/조직/멤버 등 워크스페이스 메타데이터 — 자주 바뀌지 않음 */
  WORKSPACE_META: 5 * MINUTE,

  /** 이미지 메모리 캐시 — Object URL 등 */
  IMAGE_MEMORY: 50 * MINUTE,

  /** 이미지 영구 캐시 (IndexedDB) */
  IMAGE_PERSIST: 45 * MINUTE,

  /** soft-delete guard — 클라이언트 삭제 후 서버 동기화 보호 기간 */
  LOCAL_DELETE_GUARD_SHORT: 7 * DAY,
  LOCAL_DELETE_GUARD_LONG: 30 * DAY,

  /** outbox dead-letter — 영구 실패 항목 보관 기간 */
  DEAD_LETTER: 30 * DAY,
} as const;

/** 주어진 fetchedAt(ms) 가 TTL 범위 내라면 true */
export function isCacheFresh(fetchedAt: number | null | undefined, ttlMs: number): boolean {
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt < ttlMs;
}
