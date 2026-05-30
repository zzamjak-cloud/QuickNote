import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";

export type InternalNavigationClick = {
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function shouldOpenInternalLinkInNewTab(event: InternalNavigationClick): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

export function openPageInCurrentTab(pageId: string): void {
  useSettingsStore.getState().setCurrentTabPage(pageId);
  usePageStore.getState().setActivePage(pageId);
}

export function openPageInNewTab(pageId: string): void {
  useSettingsStore.getState().openTab(pageId);
  usePageStore.getState().setActivePage(pageId);
}

export function openDatabaseInCurrentTab(databaseId: string): void {
  useSettingsStore.getState().setCurrentTabDatabase(databaseId);
  usePageStore.getState().setActivePage(null);
}

export function openDatabaseInNewTab(databaseId: string): void {
  useSettingsStore.getState().openDatabaseTab(databaseId);
  usePageStore.getState().setActivePage(null);
}
