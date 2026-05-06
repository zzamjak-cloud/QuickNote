// v4 첫 부팅 시 v1~v3 잔여 데이터 폐기.
// 사용자 합의: 기존 데이터는 개발 단계 테스트 데이터이므로 마이그레이션 없이 폐기.

const LEGACY_LOCAL_STORAGE_KEYS = [
  "quicknote.pages.v1",
  "quicknote.activePageId.v1",
  "quicknote.schemaVersion",
  "quicknote.databases",
  "quicknote.contacts",
];

export function purgeLegacyLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of LEGACY_LOCAL_STORAGE_KEYS) {
    if (localStorage.getItem(k) !== null) {
      console.warn(`[v4] purging legacy localStorage key: ${k}`);
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
        console.warn(`[v4] dropped legacy SQLite table: ${t}`);
      } catch (err) {
        console.warn(`[v4] drop ${t} failed`, err);
      }
    }
  } catch (err) {
    console.warn("[v4] tauri sql cleanup skipped", err);
  }
}
