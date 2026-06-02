import type { SnippetFeedItem } from "./useSearchController";

type Props = {
  items: SnippetFeedItem[];
  total: number;
  indexing: boolean;
  hasQuery: boolean;
  onLoadMore: () => void;
  onOpenHit: (pageId: string, blockId: string | null, blockIndex: number) => void;
};

/** 우측 컬럼 — 본문 키워드 스니펫 피드(최신 수정일 우선). 클릭 시 해당 블록으로 이동. */
export function SearchSnippetFeed({
  items,
  total,
  indexing,
  hasQuery,
  onLoadMore,
  onOpenHit,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800">
        본문 검색 결과 {hasQuery ? `(${total})` : ""}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!hasQuery ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">
            {indexing ? "인덱싱 중…" : "검색어를 입력하면 본문 내용을 찾습니다"}
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">
            본문에서 일치하는 내용이 없습니다
          </p>
        ) : (
          <>
            {items.map(({ hit, snippet }) => (
              <button
                key={hit.pageId}
                type="button"
                onClick={() =>
                  onOpenHit(
                    hit.pageId,
                    snippet?.blockRef.blockId ?? null,
                    snippet?.blockRef.blockIndex ?? 0,
                  )
                }
                className="block w-full border-b border-zinc-50 px-3 py-2 text-left hover:bg-zinc-100 dark:border-zinc-800/60 dark:hover:bg-zinc-800"
              >
                <div className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {hit.title || "제목 없음"}
                </div>
                {snippet ? (
                  <div className="mt-0.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <span>{snippet.snippet.before}</span>
                    <mark className="rounded bg-yellow-200 px-0.5 text-zinc-900 dark:bg-yellow-500/40 dark:text-yellow-50">
                      {snippet.snippet.match}
                    </mark>
                    <span>{snippet.snippet.after}</span>
                  </div>
                ) : null}
              </button>
            ))}
            {items.length < total ? (
              <button
                type="button"
                onClick={onLoadMore}
                className="mt-1 w-full px-3 py-2 text-center text-xs text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
              >
                더보기 ({total - items.length})
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
