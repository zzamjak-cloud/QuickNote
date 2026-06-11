// IconPicker 통합 탭 — 최근 사용 아이콘 (로컬 persist)

const LS_KEY = "quicknote.recentPageIcons.v1";
const MAX_RECENT = 24;

export function loadRecentIcons(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export function pushRecentIcon(icon: string | null | undefined): string[] {
  if (!icon?.trim()) return loadRecentIcons();
  const prev = loadRecentIcons().filter((item) => item !== icon);
  const next = [icon, ...prev].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
  return next;
}
