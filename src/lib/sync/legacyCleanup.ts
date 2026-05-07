// v4 첫 부팅 시 v1~v3 잔여 데이터 폐기.
// 사용자 합의: 기존 데이터는 개발 단계 테스트 데이터이므로 마이그레이션 없이 폐기.
//
// 중요: "quicknote.pages.v1" 은 v5 부터 pageStore persist 키로 재사용되므로
// legacy 리스트에서 제외. 이전에는 부팅 시마다 삭제되어 새로고침 후 새 페이지가
// 일시 사라지는 증상의 원인이었다.

const LEGACY_LOCAL_STORAGE_KEYS = [
  "quicknote.activePageId.v1",
  "quicknote.schemaVersion",
  "quicknote.databases",
  "quicknote.contacts",
];

export function purgeLegacyLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of LEGACY_LOCAL_STORAGE_KEYS) {
    if (localStorage.getItem(k) !== null) {
      if (import.meta.env.DEV) console.info(`[v4] purged legacy localStorage key: ${k}`);
      localStorage.removeItem(k);
    }
  }
}

const LEGACY_SQL_TABLES = [
  "pages",
  "databases",
  "contacts",
  "history",
];

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function purgeLegacyTauriData(): Promise<void> {
  if (!isTauri) return;
  try {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const d = await Database.load("sqlite:quicknote.db");
    for (const t of LEGACY_SQL_TABLES) {
      try {
        await d.execute(`DROP TABLE IF EXISTS ${t}`);
        if (import.meta.env.DEV) console.info(`[v4] dropped legacy SQLite table: ${t}`);
      } catch (err) {
        console.warn(`[v4] drop ${t} failed`, err);
      }
    }
  } catch (err) {
    console.warn("[v4] tauri sql cleanup skipped", err);
  }
}
