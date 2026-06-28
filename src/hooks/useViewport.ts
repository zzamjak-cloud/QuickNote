import { useSyncExternalStore } from "react";

// 뷰포트 폭 기반 반응형 분기 훅. matchMedia 구독(SSR-safe).
// - phone:  < md(768)  — 모바일 전용 컴포넌트(카드 DB·시트·큰 타깃)
// - compact: < lg(1024) — 셸 동작(사이드바 drawer·우측패널 숨김·본문 전폭)
// CSS 로 처리 가능한 분기는 Tailwind(`lg:` 등)를 쓰고, 컴포넌트 종류 자체가 달라질 때만 이 훅을 쓴다.

const PHONE_QUERY = "(max-width: 767px)";
const COMPACT_QUERY = "(max-width: 1023px)";

const hasMatchMedia = typeof window !== "undefined" && !!window.matchMedia;

// useSyncExternalStore 는 안정적인 subscribe/getSnapshot 참조가 필요하므로 쿼리별로 1회 생성한다.
function makeMediaStore(query: string) {
  const subscribe = (callback: () => void) => {
    if (!hasMatchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  };
  const getSnapshot = () =>
    hasMatchMedia ? window.matchMedia(query).matches : false;
  return { subscribe, getSnapshot };
}

// 서버/초기 렌더는 데스크톱으로 가정(클라이언트에서 즉시 보정) — 데스크톱 회귀 방지.
const getServerSnapshot = () => false;

const phoneStore = makeMediaStore(PHONE_QUERY);
const compactStore = makeMediaStore(COMPACT_QUERY);

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    phoneStore.subscribe,
    phoneStore.getSnapshot,
    getServerSnapshot,
  );
}

export function useIsCompact(): boolean {
  return useSyncExternalStore(
    compactStore.subscribe,
    compactStore.getSnapshot,
    getServerSnapshot,
  );
}
