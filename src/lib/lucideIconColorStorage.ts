// IconPicker 루시드 탭 — 마지막 선택 컬러 유지

const LS_KEY = "quicknote.iconPickerLucideColor.v1";
const DEFAULT_COLOR = "#3f3f46";

export function loadLucideIconColor(): string {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw || !/^#[0-9a-fA-F]{6}$/.test(raw)) return DEFAULT_COLOR;
    return raw;
  } catch {
    return DEFAULT_COLOR;
  }
}

export function saveLucideIconColor(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  try {
    window.localStorage.setItem(LS_KEY, color);
  } catch {
    /* noop */
  }
}
