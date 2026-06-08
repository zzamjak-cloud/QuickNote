import type { DatabaseStore } from "../../store/databaseStore";
import type { PageStore } from "../../store/pageStore";
import type { DatabaseBundle } from "../../types/database";
import type { Page } from "../../types/page";
import { collectDatabaseDependencyIds } from "./databaseQueryDependencies";

export type PickedDatabaseMap = Record<string, DatabaseBundle>;
export type PickedPageMap = Record<string, Page>;

function addId(ids: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const id = value.trim();
  if (id) ids.add(id);
}

function addStringArrayIds(ids: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addId(ids, item);
}

export function createDatabaseDependencyMapSelector(
  initialDatabaseIds: readonly string[],
) {
  const initialIds = Array.from(new Set(initialDatabaseIds)).sort();

  return (state: DatabaseStore): PickedDatabaseMap => {
    const picked: PickedDatabaseMap = {};
    const seen = new Set<string>();
    const queue = [...initialIds];

    for (let index = 0; index < queue.length; index += 1) {
      const databaseId = queue[index];
      if (!databaseId || seen.has(databaseId)) continue;
      seen.add(databaseId);

      const database = state.databases[databaseId];
      if (!database) continue;
      picked[databaseId] = database;

      for (const nextDatabaseId of collectDatabaseDependencyIds(databaseId, database.columns)) {
        if (!seen.has(nextDatabaseId)) queue.push(nextDatabaseId);
      }
    }

    return picked;
  };
}

export function createPageDependencyMapSelector(initialPageIds: readonly string[]) {
  const initialIds = Array.from(new Set(initialPageIds)).sort();

  return (state: PageStore): PickedPageMap => {
    const ids = new Set(initialIds);

    for (const pageId of initialIds) {
      const page = state.pages[pageId];
      if (!page?.dbCells) continue;
      for (const value of Object.values(page.dbCells)) addStringArrayIds(ids, value);
    }

    const picked: PickedPageMap = {};
    for (const pageId of Array.from(ids).sort()) {
      const page = state.pages[pageId];
      if (page) picked[pageId] = page;
    }

    return picked;
  };
}
