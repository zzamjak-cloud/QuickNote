import { useMemo, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import type { Page } from "../../types/page";
import {
  buildPageTreeRows,
  countPageDescendants,
  findPageTreeDatabaseContext,
  findPageTreeRootId,
} from "./pageSubpageTreeUtils";

type TreeRow = {
  page: Page;
  depth: number;
};

type PageSubpageTreeProps = {
  rootPageId?: string | null;
  currentPageId: string | null;
  className?: string;
  compact?: boolean;
  onNavigate?: (pageId: string) => void;
  hideHeader?: boolean;
};

function pageIcon(icon: string | null): ReactNode {
  if (!icon || /^https?:|^quicknote-image:|^data:/i.test(icon)) {
    return <FileText size={14} className="text-zinc-400" />;
  }
  return <span className="text-sm leading-none">{icon}</span>;
}

export function PageSubpageTree({
  rootPageId,
  currentPageId,
  className = "",
  compact = false,
  onNavigate,
  hideHeader = false,
}: PageSubpageTreeProps) {
  const pages = usePageStore(useShallow((s) => s.pages));
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const requestDatabaseTreeFocus = useUiStore((s) => s.requestDatabaseTreeFocus);

  const { rootId, rows, descendantCount } = useMemo(() => {
    const resolvedRootId = rootPageId ?? findPageTreeRootId(currentPageId, pages);
    if (!resolvedRootId || !pages[resolvedRootId]) {
      return { rootId: null, rows: [] as TreeRow[], descendantCount: 0 };
    }
    const nextRows = buildPageTreeRows(resolvedRootId, pages).map((row) => ({
      page: row.page,
      depth: row.depth,
    }));
    return {
      rootId: resolvedRootId,
      rows: nextRows,
      descendantCount: countPageDescendants(resolvedRootId, pages),
    };
  }, [currentPageId, pages, rootPageId]);

  const hasContext = !!currentPageId && !!rootId && currentPageId !== rootId;
  if (!rootId || (descendantCount === 0 && !hasContext)) return null;

  const navigate = (pageId: string): void => {
    const databaseContext = findPageTreeDatabaseContext(pageId, pages);
    if (databaseContext) {
      requestDatabaseTreeFocus(databaseContext.databaseId, pageId);
    }
    if (onNavigate) {
      onNavigate(pageId);
      return;
    }
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <div className={`border-t border-zinc-100 pt-4 dark:border-zinc-800 ${className}`}>
      {!hideHeader ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">하위 페이지 구조</p>
          {descendantCount > 0 && (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{descendantCount}개</span>
          )}
        </div>
      ) : null}
      <div className={compact ? "space-y-0.5 text-sm" : "space-y-1 text-sm"}>
        {rows.map(({ page, depth }) => {
          const isCurrent = page.id === currentPageId;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => navigate(page.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                isCurrent
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
              }`}
              style={{ paddingLeft: 8 + depth * 18 }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">{pageIcon(page.icon)}</span>
              <span className="min-w-0 flex-1 truncate">{page.title || "제목 없음"}</span>
              {isCurrent && (
                <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
                  현재 위치
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
