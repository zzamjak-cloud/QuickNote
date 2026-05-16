const DELETED_SCHEDULE_PAGES_KEY = "quicknote.lcScheduler.deletedPages.v1";

let memoryDeletedPageIds: Set<string> | null = null;

function readDeletedPageIds(): Set<string> {
  if (memoryDeletedPageIds) return memoryDeletedPageIds;
  if (typeof localStorage === "undefined") {
    memoryDeletedPageIds = new Set();
    return memoryDeletedPageIds;
  }
  try {
    const raw = localStorage.getItem(DELETED_SCHEDULE_PAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    memoryDeletedPageIds = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    memoryDeletedPageIds = new Set();
  }
  return memoryDeletedPageIds;
}

function writeDeletedPageIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DELETED_SCHEDULE_PAGES_KEY, JSON.stringify([...ids]));
}

export function markDeletedSchedulePage(pageId: string): void {
  const ids = readDeletedPageIds();
  ids.add(pageId);
  writeDeletedPageIds(ids);
}

export function isDeletedSchedulePage(pageId: string): boolean {
  return readDeletedPageIds().has(pageId);
}
