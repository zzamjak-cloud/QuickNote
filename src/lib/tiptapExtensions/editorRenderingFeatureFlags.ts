export const EDITOR_LAZY_INACTIVE_TAB_PANELS_FLAG =
  "quicknote.editor.lazyInactiveTabPanels";

export function isEditorLazyInactiveTabPanelsEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(EDITOR_LAZY_INACTIVE_TAB_PANELS_FLAG) === "1";
  } catch {
    return false;
  }
}
