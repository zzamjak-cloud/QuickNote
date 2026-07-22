import type { CellValue } from "../../types/database";
import type { PageStore } from "../../store/pageStore";
import type { DatabaseRowIndexEntry } from "../../lib/database/databaseRowIndexCache";

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

export function createDatabaseRowSourcesSelector(
  rowPageOrder: readonly string[],
  fallbackRows: readonly DatabaseRowIndexEntry[] = [],
) {
  let cachedById = new Map<string, CachedRowSource>();
  let lastOutput: DatabaseRowSource[] = [];
  const fallbackById = new Map(fallbackRows.map((row) => [row.pageId, row]));

  return (state: PageStore): DatabaseRowSource[] => {
    const nextOutput: DatabaseRowSource[] = [];
    const nextCache = new Map<string, CachedRowSource>();
    let changed = false;

    for (const pageId of rowPageOrder) {
      const page = state.pages[pageId];
      if (!page) {
        const fallback = fallbackById.get(pageId);
        if (!fallback) {
          changed = true;
          continue;
        }
        if (fallback.dbCells?.["_qn_isTemplate"] === "1") continue;
        const cached = cachedById.get(pageId);
        const source = sameRowSource(
          cached,
          fallback.databaseId,
          fallback.title,
          fallback.icon,
          fallback.dbCells,
        )
          ? cached.source
          : {
              pageId,
              databaseId: fallback.databaseId,
              title: fallback.title,
              icon: fallback.icon,
              dbCells: fallback.dbCells,
            };
        nextCache.set(pageId, {
          databaseId: fallback.databaseId,
          title: fallback.title,
          icon: fallback.icon,
          dbCells: fallback.dbCells,
          source,
        });
        if (lastOutput[nextOutput.length] !== source) changed = true;
        nextOutput.push(source);
        continue;
      }
      // 구독/row-index 순서가 엇갈려 rowPageOrder에 남아 있어도 템플릿은 행으로 렌더하지 않는다.
      if (page.dbCells?.["_qn_isTemplate"] === "1") continue;

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

    if (lastOutput.length !== nextOutput.length) changed = true;
    cachedById = nextCache;
    if (!changed) return lastOutput;
    lastOutput = nextOutput;
    return nextOutput;
  };
}
