import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { PageIconDisplay } from "../../common/PageIconDisplay";
import { PageLinkSearchPopup } from "./PageLinkSearchPopup";
import { useOpenPageInPeek } from "../../page/useOpenPageInPeek";

type Props = {
  databaseId: string;
  rowId: string;
  columnId: string;
  value: string[];
  readOnly?: boolean;
};

export function PageLinkCell({ databaseId, rowId, columnId, value, readOnly = false }: Props) {
  const [popupOpen, setPopupOpen] = useState(false);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const pages = usePageStore((s) => s.pages);
  const openPageInPeek = useOpenPageInPeek();
  const updatePageLinkCell = useDatabaseStore((s) => s.updatePageLinkCell);
  // 현재 컬럼 정의 — pageLinkScopeDatabaseId / searchFilters 추출
  const column = useDatabaseStore((s) =>
    s.databases[databaseId]?.columns.find((c) => c.id === columnId),
  );
  const scopeDatabaseId = column?.config?.pageLinkScopeDatabaseId;
  const searchFilters = column?.config?.searchFilters;
  const isReadOnly = readOnly;

  function handleToggle(pageId: string) {
    const next = value.includes(pageId)
      ? value.filter((id) => id !== pageId)
      : [...value, pageId];
    updatePageLinkCell(databaseId, rowId, columnId, next);
  }

  const linkedPages = value
    .map((id) => pages[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="group flex min-h-[24px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5">
      {linkedPages.map((page) => (
        <span
          key={page.id}
          className="flex items-center gap-0.5 rounded pl-1.5 pr-0.5 py-0.5"
          style={{ backgroundColor: "#bfd5f3" }}
        >
          <button
            type="button"
            onClick={() => {
              void openPageInPeek(page.id, {
                workspaceId: page.workspaceId ?? null,
                source: "page-link-cell",
              });
            }}
            className="flex items-center gap-1 text-xs font-semibold"
            style={{ color: "#0f345c" }}
            title={`${page.title}로 이동`}
          >
            <PageIconDisplay icon={page.icon ?? null} size="sm" />
            <span className="max-w-[100px] truncate">{page.title || "제목 없음"}</span>
          </button>
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => handleToggle(page.id)}
              className="ml-0.5 rounded p-0.5 hover:bg-[#a8c5ef]"
              style={{ color: "#0f345c" }}
              title="연결 해제"
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}

      {linkedPages.length === 0 && (
        <span className="text-xs text-zinc-400">연결 없음</span>
      )}

      {/* 미러 컬럼은 검색 버튼 미표시 */}
      {!isReadOnly && (
        <button
          ref={searchBtnRef}
          type="button"
          onClick={() => setPopupOpen(true)}
          className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="페이지 연결 추가"
        >
          <Search size={12} />
        </button>
      )}

      {!isReadOnly && popupOpen && (
        <PageLinkSearchPopup
          anchorEl={searchBtnRef.current}
          selectedIds={value}
          excludePageId={rowId}
          scopeDatabaseId={scopeDatabaseId}
          searchFilters={searchFilters}
          prefsDatabaseId={databaseId}
          prefsColumnId={columnId}
          onToggle={handleToggle}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  );
}
