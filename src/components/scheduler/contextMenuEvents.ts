export const SCHEDULER_CONTEXT_MENU_OPEN_EVENT =
  "quicknote:scheduler-context-menu-open";

export function announceSchedulerContextMenuOpen() {
  window.dispatchEvent(new Event(SCHEDULER_CONTEXT_MENU_OPEN_EVENT));
}
