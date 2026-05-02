import { useEffect, useMemo, useState } from "react";
import { ArrowUpToLine, Search } from "lucide-react";
import {
  usePageStore,
  selectPageTree,
  type PageNode,
} from "../../store/pageStore";

type Props = {
  pageId: string | null;
  onClose: () => void;
};

// 페이지를 다른 페이지의 자식으로 이동시키는 picker 모달.
export function PageMoveDialog({ pageId, onClose }: Props) {
  const tree = usePageStore(selectPageTree);
  const movePage = usePageStore((s) => s.movePage);
  const pages = usePageStore((s) => s.pages);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [pageId]);

  const flatList = useMemo(() => {
    const out: { node: PageNode; depth: number; disabled: boolean }[] = [];
    const walk = (nodes: PageNode[], depth: number, ancestorBlocked: boolean) => {
      for (const n of nodes) {
        const isSelf = n.id === pageId;
        const blocked = ancestorBlocked || isSelf;
        out.push({ node: n, depth, disabled: blocked });
        walk(n.children, depth + 1, blocked);
      }
    };
    walk(tree, 0, false);
    const q = query.trim().toLowerCase();
    if (!q) return out;
    return out.filter((x) => x.node.title.toLowerCase().includes(q));
  }, [tree, pageId, query]);

  if (!pageId) return null;
  const target = pages[pageId];
  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg bg-white p-3 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          "{target.title}" 이동
        </h3>
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800">
          <Search size={13} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="페이지 검색"
            autoFocus
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              movePage(pageId, null, Number.MAX_SAFE_INTEGER);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ArrowUpToLine size={14} className="text-zinc-500" />
            <span>루트로 이동</span>
          </button>
          <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
          {flatList.length === 0 ? (
            <p className="px-2 py-2 text-xs text-zinc-400">
              일치하는 페이지가 없습니다.
            </p>
          ) : (
            flatList.map(({ node, depth, disabled }) => (
              <button
                key={node.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  movePage(pageId, node.id, Number.MAX_SAFE_INTEGER);
                  onClose();
                }}
                className={[
                  "flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm",
                  disabled
                    ? "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}
                style={{ paddingLeft: depth * 14 + 8 }}
                title={
                  disabled
                    ? "자기 자신 또는 자손으로는 이동할 수 없습니다"
                    : "여기 자식으로 이동"
                }
              >
                <span className="w-5 text-center">{node.icon ?? "📄"}</span>
                <span className="truncate">{node.title || "제목 없음"}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex justify-end gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
