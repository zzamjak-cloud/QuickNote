import type { CellValue } from "../../types/database";
import type { PageStore } from "../../store/pageStore";

export type DatabaseRowSource = {
  pageId: string;
  databaseId: string;
  title: string;
  icon: string | null;
  dbCells?: Record<string, CellValue>;
};

type CachedRowSource = {
  databaseId: string | undefined;
  title: string;
  icon: string | null;
  dbCells: Record<string, CellValue> | undefined;
  source: DatabaseRowSource;
};

function sameRowSource(
  cached: CachedRowSource | undefined,
  databaseId: string | undefined,
  title: string,
  icon: string | null,
  dbCells: Record<string, CellValue> | undefined,
): cached is CachedRowSource {
  return Boolean(
    cached &&
      cached.databaseId === databaseId &&
      cached.title === title &&
      cached.icon === icon &&
      cached.dbCells === dbCells,
  );
}

export function createDatabaseRowSourcesSelector(rowPageOrder: readonly string[]) {
  let cachedById = new Map<string, CachedRowSource>();
  let lastOutput: DatabaseRowSource[] = [];

  return (state: PageStore): DatabaseRowSource[] => {
    const nextOutput: DatabaseRowSource[] = [];
    const nextCache = new Map<string, CachedRowSource>();
    let changed = lastOutput.length !== rowPageOrder.length;

    for (const pageId of rowPageOrder) {
      const page = state.pages[pageId];
      if (!page) {
        changed = true;
        continue;
      }

      const cached = cachedById.get(pageId);
      const databaseId = page.databaseId;
      const icon = page.icon ?? null;
      const dbCells = page.dbCells;
      const source = sameRowSource(cached, databaseId, page.title, icon, dbCells)
        ? cached.source
        : {
            pageId,
            databaseId: databaseId ?? "",
            title: page.title,
            icon,
            dbCells,
          };

      nextCache.set(pageId, {
        databaseId,
        title: page.title,
        icon,
        dbCells,
        source,
      });
      if (lastOutput[nextOutput.length] !== source) changed = true;
      nextOutput.push(source);
    }

    cachedById = nextCache;
    if (!changed) return lastOutput;
    lastOutput = nextOutput;
    return nextOutput;
  };
}
