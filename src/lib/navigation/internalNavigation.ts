import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";

export type InternalNavigationClick = {
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function shouldOpenInternalLinkInNewTab(event: InternalNavigationClick): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

function pageExists(pageId: string): boolean {
  return Boolean(usePageStore.getState().pages[pageId]);
}

export function openPageInCurrentTab(pageId: string): boolean {
  if (!pageExists(pageId)) return false;
  useSettingsStore.getState().setCurrentTabPage(pageId);
  usePageStore.getState().setActivePage(pageId);
  return true;
}

export function openPageInNewTab(pageId: string): boolean {
  if (!pageExists(pageId)) return false;
  useSettingsStore.getState().openTab(pageId);
  usePageStore.getState().setActivePage(pageId);
  return true;
}

export function openDatabaseInCurrentTab(databaseId: string): void {
  useSettingsStore.getState().setCurrentTabDatabase(databaseId);
  usePageStore.getState().setActivePage(null);
}

export function openDatabaseInNewTab(databaseId: string): void {
  useSettingsStore.getState().openDatabaseTab(databaseId);
  usePageStore.getState().setActivePage(null);
}
