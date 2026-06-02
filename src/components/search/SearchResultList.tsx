import { Database } from "lucide-react";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { usePageStore } from "../../store/pageStore";
import type { PageHit, DbHit } from "../../lib/search/searchEngine";

type Props = {
  items: PageHit[];
  total: number;
  dbHits: DbHit[];
  hasQuery: boolean;
  onLoadMore: () => void;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
};

/** 좌측 컬럼 — 페이지 / DB 리스트(관련도 정렬). 빈 검색어면 최근 페이지. */
export function SearchResultList({
  items,
  total,
  dbHits,
  hasQuery,
  onLoadMore,
  onOpenPage,
  onOpenDatabase,
}: Props) {
  const pages = usePageStore((s) => s.pages);
  const empty = items.length === 0 && dbHits.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800">
        {hasQuery ? "페이지 · 데이터베이스" : "최근 페이지"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {empty ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">
            {hasQuery ? "일치하는 항목이 없습니다" : "페이지가 없습니다"}
          </p>
        ) : (
          <>
            {items.map((item) => (
              <button
                key={item.pageId}
                type="button"
                onClick={() => onOpenPage(item.pageId)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span className="shrink-0">
                  <PageIconDisplay icon={pages[item.pageId]?.icon ?? null} size="sm" />
                </span>
                <span className="truncate">{item.title || "제목 없음"}</span>
                {item.kind === "db-row" ? (
                  <span className="ml-auto shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-400 dark:bg-zinc-800">
                    DB
                  </span>
                ) : null}
              </button>
            ))}
            {items.length < total ? (
              <button
                type="button"
                onClick={onLoadMore}
                className="mt-1 w-full px-3 py-1.5 text-center text-xs text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
              >
                더보기 ({total - items.length})
              </button>
            ) : null}

            {dbHits.length > 0 ? (
              <>
                <div className="mt-1 border-t border-zinc-100 px-3 py-1.5 text-[11px] font-medium text-zinc-400 dark:border-zinc-800">
                  데이터베이스
                </div>
                {dbHits.map((db) => (
                  <button
                    key={db.databaseId}
                    type="button"
                    onClick={() => onOpenDatabase(db.databaseId)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Database size={15} className="shrink-0 text-zinc-400" />
                    <span className="truncate">{db.title || "제목 없음"}</span>
                  </button>
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
