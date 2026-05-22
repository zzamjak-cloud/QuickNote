import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Database, Search } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore, listDatabases } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { koreanIncludes } from "../../lib/koreanSearch";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { emptyPanelState } from "../../types/database";

type FilterMode = "page" | "db" | null;

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
};

export function PageSearchPopup({ anchorEl, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("page");
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const pages = usePageStore((s) => s.pages);
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const findFullPagePageIdForDatabase = usePageStore((s) => s.findFullPagePageIdForDatabase);
  const databases = useDatabaseStore(listDatabases);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  // 앵커 버튼 기준 위치 계산
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 280;
    const gap = 6;
    const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
    setStyle({
      position: "fixed",
      top: rect.bottom + gap,
      left: Math.max(8, left),
      width: popupWidth,
      zIndex: 9999,
    });
  }, [anchorEl]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();

  // DB와 연결된 페이지 ID 집합 — 페이지 목록에서 제외
  const dbPageIds = new Set(
    databases.map((db) => findFullPagePageIdForDatabase(db.id)).filter(Boolean) as string[],
  );

  const allPages = Object.values(pages).filter(
    (p) => !dbPageIds.has(p.id) && !p.databaseId,
  );

  const filteredPages = q
    ? allPages.filter((p) => koreanIncludes(p.title.toLowerCase(), q))
    : allPages
        .slice()
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 10);

  const filteredDbs = q
    ? databases.filter((d) => koreanIncludes(d.meta.title.toLowerCase(), q))
    : databases.slice(0, 10);

  const showPages = filterMode === null || filterMode === "page";
  const showDbs = filterMode === null || filterMode === "db";

  const handlePageClick = (id: string) => {
    setCurrentTabPage(id);
    setActivePage(id);
    onClose();
  };

  const handleDatabaseClick = (databaseId: string, title: string) => {
    const pageId =
      findFullPagePageIdForDatabase(databaseId) ??
      (() => {
        const id = createPage(title, null, { activate: false });
        updateDoc(id, {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId,
                layout: "fullPage",
                view: "table",
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        });
        return id;
      })();
    setCurrentTabPage(pageId);
    setActivePage(pageId);
    onClose();
  };

  const toggleFilter = (mode: "page" | "db") => {
    setFilterMode((prev) => (prev === mode ? null : mode));
  };

  const tabBase = "rounded-md px-3 py-1 text-xs font-medium transition-colors";
  const tabActive = "bg-green-500 text-white";
  const tabInactive = "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  const visiblePages = showPages ? filteredPages : [];
  const visibleDbs = showDbs ? filteredDbs : [];
  const isEmpty = visiblePages.length === 0 && visibleDbs.length === 0;

  return createPortal(
    <div
      ref={popupRef}
      style={style}
      className="rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 검색 입력 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Search size={15} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="페이지 또는 데이터베이스 검색..."
          className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => toggleFilter("page")}
          className={`${tabBase} ${filterMode === "page" ? tabActive : tabInactive}`}
        >
          페이지
        </button>
        <button
          type="button"
          onClick={() => toggleFilter("db")}
          className={`${tabBase} ${filterMode === "db" ? tabActive : tabInactive}`}
        >
          DB
        </button>
      </div>

      {/* 결과 목록 */}
      <div className="max-h-72 overflow-y-auto py-1">
        {visiblePages.map((page) => (
          <button
            key={page.id}
            type="button"
            onClick={() => handlePageClick(page.id)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <PageIconDisplay icon={page.icon ?? null} size="sm" />
            <span className="truncate">{page.title || "제목 없음"}</span>
          </button>
        ))}

        {visibleDbs.map((db) => (
          <button
            key={db.id}
            type="button"
            onClick={() => handleDatabaseClick(db.id, db.meta.title || "데이터베이스")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Database size={15} className="shrink-0 text-zinc-400" />
            <span className="truncate">{db.meta.title || "제목 없음"}</span>
          </button>
        ))}

        {isEmpty && (
          <p className="px-3 py-4 text-center text-sm text-zinc-400">
            검색 결과가 없습니다
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
