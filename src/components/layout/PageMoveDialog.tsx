import { useEffect, useMemo, useState } from "react";
import { ArrowUpToLine, Search } from "lucide-react";
import {
  usePageStore,
  selectPageTree,
  type PageNode,
} from "../../store/pageStore";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";

type Props = {
  pageId: string | null;
  onClose: () => void;
};

// 페이지를 다른 페이지의 자식으로 이동시키는 picker 모달.
export function PageMoveDialog({ pageId, onClose }: Props) {
  const tree = usePageStore(selectPageTree);
  const movePage = usePageStore((s) => s.movePage);
  const pages = usePageStore((s) => s.pages);
  const findFullPagePageIdForDatabase = usePageStore(
    (s) => s.findFullPagePageIdForDatabase,
  );
  const dbList = useDatabaseStore(listDatabases);
  const attachPageAsRow = useDatabaseStore((s) => s.attachPageAsRow);
  const detachRowToNormalPage = useDatabaseStore((s) => s.detachRowToNormalPage);
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
  const isRowPage = !!target.databaseId;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredDbList =
    normalizedQuery.length === 0
      ? dbList
      : dbList.filter((d) => d.meta.title.toLowerCase().includes(normalizedQuery));
  const selectableDbList = filteredDbList.filter((d) => {
    // 1) 현재 페이지가 특정 DB의 fullPage 루트라면 그 DB로는 자기 자신 이동이므로 제외
    if (findFullPagePageIdForDatabase(d.id) === pageId) return false;
    // 2) 이미 해당 DB의 row 페이지인 경우도 자기 자신 DB로의 재이동(no-op)이므로 제외
    if (target.databaseId && target.databaseId === d.id) return false;
    return true;
  });

  // 데이터베이스 항목(row 페이지) 목록을 DB 별로 묶어서 보여준다.
  // 일반 페이지를 항목의 자식으로 넣거나, 항목 자식인 페이지를 다른 항목으로 옮길 때 사용.
  const rowTargetGroups = dbList
    .map((d) => {
      const rows = Object.values(pages)
        .filter((p) => p.databaseId === d.id)
        .filter((p) => p.id !== pageId)
        .sort((a, b) => a.order - b.order);
      return { db: d, rows };
    })
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      if (!normalizedQuery) return g;
      const dbMatch = g.db.meta.title.toLowerCase().includes(normalizedQuery);
      if (dbMatch) return g;
      return {
        db: g.db,
        rows: g.rows.filter((r) =>
          (r.title || "").toLowerCase().includes(normalizedQuery),
        ),
      };
    })
    .filter((g) => g.rows.length > 0);

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
            placeholder="페이지/DB 검색"
            autoFocus
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              if (isRowPage) detachRowToNormalPage(pageId);
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
                  if (isRowPage) detachRowToNormalPage(pageId);
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
          {rowTargetGroups.length > 0 && (
            <>
              <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
              <div className="px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                데이터베이스 항목의 하위 페이지로 이동
              </div>
              {rowTargetGroups.map(({ db, rows }) => (
                <div key={db.id}>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-400">
                    {db.meta.title || "제목 없음"}
                  </div>
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        // 항목의 자식으로 넣기 위해 먼저 row 속성을 떼어 일반 페이지로 만든다.
                        if (isRowPage) detachRowToNormalPage(pageId);
                        movePage(pageId, r.id, Number.MAX_SAFE_INTEGER);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      style={{ paddingLeft: 22 }}
                      title="이 항목 페이지의 자식으로 이동"
                    >
                      <span className="w-5 text-center">{r.icon ?? "📄"}</span>
                      <span className="truncate">{r.title || "제목 없음"}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
          <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
          <div className="px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            데이터베이스 항목으로 이동
          </div>
          {selectableDbList.length === 0 ? (
            <p className="px-2 py-2 text-xs text-zinc-400">
              일치하는 데이터베이스가 없습니다.
            </p>
          ) : (
            selectableDbList.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  attachPageAsRow(d.id, pageId);
                  onClose();
                }}
                className="flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="이 데이터베이스의 항목으로 추가"
              >
                <span className="w-5 text-center">🗂️</span>
                <span className="truncate">{d.meta.title || "제목 없음"}</span>
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
