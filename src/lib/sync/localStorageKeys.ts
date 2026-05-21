// quicknote 가 사용하는 localStorage 키를 한 곳에 정리한다.
//
// 범위:
// 1) zustand persist 의 name: 옵션 → 각 store 파일에 그대로 둠 (그게 단일 출처).
// 2) 직접 localStorage 호출이 필요한 키 → 본 파일의 상수로 export.
// 3) 과거 버전의 키(legacy)는 LEGACY_KEYS 로 묶어 legacyCleanup 이 일괄 정리한다.
//
// 새 키를 추가할 때:
//  - zustand persist 면 store 파일의 name: 그대로 두고 본 파일에 변경 없음.
//  - 직접 호출이면 본 파일에 상수 추가하고 호출처에서 import.

/** 직접 localStorage.getItem / setItem 호출에 쓰는 키. */
export const DIRECT_KEYS = {
  /** 스케줄러 연도 셀렉터 — 사용자가 선택한 연도 목록. */
  SCHEDULER_AVAILABLE_YEARS: "quicknote.scheduler.available-years",
} as const;

/** 더 이상 사용하지 않는 과거 키. legacyCleanup 에서 일괄 제거 대상. */
export const LEGACY_KEYS: ReadonlyArray<string> = [
  "quicknote.activePageId.v1",
  "quicknote.schemaVersion",
  "quicknote.databases",
  "quicknote.contacts",
] as const;
