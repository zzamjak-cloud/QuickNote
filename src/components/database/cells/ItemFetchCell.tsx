import { useMemo } from "react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useUiStore } from "../../../store/uiStore";
import { PageIconDisplay } from "../../common/PageIconDisplay";
import type { ColumnDef } from "../../../types/database";

type Props = {
  databaseId: string;
  rowId: string;
  column: ColumnDef;
};

export function ItemFetchCell({ rowId, column }: Props) {
  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);
  const openPeek = useUiStore((s) => s.openPeek);

  const sourceDbId = column.config?.itemFetchSourceDatabaseId;
  const matchColId = column.config?.itemFetchMatchColumnId;
  const currentTitle = pages[rowId]?.title ?? "";

  const matchedPages = useMemo(() => {
    if (!sourceDbId || !matchColId) return [];
    const sourceDb = databases[sourceDbId];
    if (!sourceDb) return [];

    const matchCol = sourceDb.columns.find((c) => c.id === matchColId);
    const isPageLinkCol = matchCol?.type === "pageLink";

    return sourceDb.rowPageOrder
      .map((pageId) => pages[pageId])
      .filter((page): page is NonNullable<typeof page> => {
        if (!page) return false;
        const cellValue = page.dbCells?.[matchColId];
        if (isPageLinkCol) {
          // pageLink 타입: 현재 행의 pageId가 대상 컬럼 배열에 포함되는지 확인
          return Array.isArray(cellValue) && (cellValue as string[]).includes(rowId);
        }
        // 그 외 타입: 대상 컬럼값(문자열)이 현재 행 제목과 일치하는지 비교
        return typeof cellValue === "string" && cellValue === currentTitle;
      });
  }, [databases, pages, sourceDbId, matchColId, rowId, currentTitle]);

  return (
    <div className="flex min-h-[24px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5">
      {matchedPages.map((page) => (
        <span
          key={page.id}
          className="flex items-center gap-0.5 rounded pl-1.5 pr-1.5 py-0.5"
          style={{ backgroundColor: "#d1fae5" }}
        >
          <button
            type="button"
            onClick={() => openPeek(page.id)}
            className="flex items-center gap-1 text-xs font-semibold"
            style={{ color: "#065f46" }}
            title={`${page.title}로 이동`}
          >
            <PageIconDisplay icon={page.icon ?? null} size="sm" />
            <span className="max-w-[120px] truncate">{page.title || "제목 없음"}</span>
          </button>
        </span>
      ))}
      {matchedPages.length === 0 && (
        <span className="text-xs text-zinc-400">—</span>
      )}
    </div>
  );
}
