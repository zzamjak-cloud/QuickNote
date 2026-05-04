import type { PageMap } from "../types/page";
import { safeParsePageMap } from "./schemas/pageMapSchema";

export const STORAGE_KEYS = {
  pages: "quicknote.pages.v1",
  activePageId: "quicknote.activePageId.v1",
  settings: "quicknote.settings.v1",
  schemaVersion: "quicknote.schemaVersion",
} as const;

export const CURRENT_SCHEMA_VERSION = 1;

// 손상되거나 없는 데이터를 마주하면 빈 상태로 폴백.
export function loadPages(): PageMap {
  ensureSchemaVersion();
  const raw = localStorage.getItem(STORAGE_KEYS.pages);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    const ok = safeParsePageMap(parsed);
    if (!ok) {
      console.warn("[storage] pages 스키마 검증 실패 — 빈 상태로 폴백");
      return {};
    }
    return ok;
  } catch (err) {
    console.error("[storage] pages 파싱 실패", err);
    return {};
  }
}

export function savePages(pages: PageMap): void {
  ensureSchemaVersion();
  localStorage.setItem(STORAGE_KEYS.pages, JSON.stringify(pages));
}

export function loadActivePageId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.activePageId);
}

export function saveActivePageId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(STORAGE_KEYS.activePageId);
  } else {
    localStorage.setItem(STORAGE_KEYS.activePageId, id);
  }
}

export function ensureSchemaVersion(): void {
  const raw = localStorage.getItem(STORAGE_KEYS.schemaVersion);
  if (raw === null) {
    localStorage.setItem(
      STORAGE_KEYS.schemaVersion,
      String(CURRENT_SCHEMA_VERSION),
    );
    return;
  }
  const stored = Number(raw);
  if (Number.isNaN(stored) || stored !== CURRENT_SCHEMA_VERSION) {
    // 향후 마이그레이션 진입점. v1에서는 no-op + 버전 갱신만 수행.
    localStorage.setItem(
      STORAGE_KEYS.schemaVersion,
      String(CURRENT_SCHEMA_VERSION),
    );
  }
}
