import { useEffect, useMemo, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import {
  databasePageTreeCollapseKey,
  useDatabasePageTreeCollapseStore,
} from "../../store/databasePageTreeCollapseStore";
import { PageIconDisplay } from "../common/PageIconDisplay";
import {
  collectPageTreePath,
  findPageTreeDatabaseContext,
} from "../page/pageSubpageTreeUtils";
import { useOpenPageInPeek } from "../page/useOpenPageInPeek";

type Props = {
  databaseId: string;
  rootPageId: string;
  className?: string;
  compact?: boolean;
};

const BASE_INDENT_PX = 24;
const INDENT_PX = 22;

export function DatabasePageSubtree({
  databaseId,
  rootPageId,
  className = "",
  compact = false,
}: Props) {
  const pages = usePageStore((s) => s.pages);
  const createPage = usePageStore((s) => s.createPage);
  const openPageInPeek = useOpenPageInPeek();
  const collapsedByKey = useDatabasePageTreeCollapseStore((s) => s.collapsedByKey);
  const setCollapsed = useDatabasePageTreeCollapseStore((s) => s.setCollapsed);
  const toggleCollapsed = useDatabasePageTreeCollapseStore((s) => s.toggle);
  const focusRequest = useUiStore((s) => s.databaseTreeFocusRequest);
  const requestDatabaseTreeFocus = useUiStore((s) => s.requestDatabaseTreeFocus);
  const clearDatabaseTreeFocus = useUiStore((s) => s.clearDatabaseTreeFocus);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const page of Object.values(pages)) {
      if (!page.parentId) continue;
      if (page.databaseId === databaseId) continue;
      const list = map.get(page.parentId) ?? [];
      list.push(page.id);
      map.set(page.parentId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const left = pages[a];
        const right = pages[b];
        if (!left || !right) return 0;
        return left.order - right.order || left.title.localeCompare(right.title);
      });
    }
    return map;
  }, [databaseId, pages]);

  useEffect(() => {
    if (!focusRequest || focusRequest.databaseId !== databaseId) return;
    const databaseContext = findPageTreeDatabaseContext(focusRequest.pageId, pages);
    if (!databaseContext || databaseContext.rowPageId !== rootPageId) return;
    const path = collectPageTreePath(focusRequest.pageId, pages, rootPageId);
    if (path.length === 0) return;
    path.slice(0, -1).forEach((pageId) => {
      setCollapsed(databaseId, pageId, false);
    });
    clearDatabaseTreeFocus();
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-qn-page-tree-node="${CSS.escape(focusRequest.pageId)}"]`,
      );
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [
    clearDatabaseTreeFocus,
    databaseId,
    focusRequest,
    pages,
    rootPageId,
    setCollapsed,
  ]);

  const createChildPage = (parentId: string, target: HTMLElement) => {
    const newPageId = createPage("새 페이지", parentId, { activate: false });
    requestDatabaseTreeFocus(databaseId, newPageId);
    setCollapsed(databaseId, parentId, false);
    void openPageInPeek(newPageId, {
      navigateInPeek: Boolean(target.closest("[data-qn-peek-editor='true']")),
      source: "database-page-tree-create-child",
    });
  };

  const openTreePage = (pageId: string, target: HTMLElement) => {
    requestDatabaseTreeFocus(databaseId, pageId);
    void openPageInPeek(pageId, {
      navigateInPeek: Boolean(target.closest("[data-qn-peek-editor='true']")),
      source: "database-page-tree-open",
    });
  };

  const renderNode = (pageId: string, depth: number): ReactNode => {
    const page = pages[pageId];
    if (!page) return null;
    const childIds = childrenByParent.get(pageId) ?? [];
    const hasChildren = childIds.length > 0;
    const collapsed = hasChildren
      ? collapsedByKey[databasePageTreeCollapseKey(databaseId, pageId)] !== false
      : false;

    return (
      <div key={pageId} className="space-y-1">
        <div
          className={[
            "group/tree flex min-w-0 items-center gap-1 rounded-md pr-1 transition-colors",
            compact ? "py-0.5 text-sm" : "py-1 text-base",
            "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
          ].join(" ")}
          style={{ paddingLeft: BASE_INDENT_PX + depth * INDENT_PX }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapsed(databaseId, pageId);
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={collapsed ? "하위 페이지 펼치기" : "하위 페이지 접기"}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className="block h-5 w-5 shrink-0" aria-hidden />
          )}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
            <PageIconDisplay icon={page.icon} size="sm" />
          </span>
          <button
            type="button"
            data-qn-page-tree-node={page.id}
            onClick={(event) => {
              event.stopPropagation();
              openTreePage(page.id, event.currentTarget);
            }}
            className={[
              "min-w-0 flex-1 rounded px-1 py-0.5 text-left text-zinc-600 dark:text-zinc-300",
              "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              compact ? "text-sm" : "text-base",
            ].join(" ")}
            title="사이드 피크 열기"
          >
            <span className="block truncate">{page.title || "제목 없음"}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              createChildPage(page.id, event.currentTarget);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover/tree:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="하위 페이지 추가"
            title="하위 페이지 추가"
          >
            <Plus size={13} />
          </button>
        </div>
        {!collapsed && (
          <div className="space-y-1">
            {childIds.map((childPageId) => renderNode(childPageId, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootChildIds = childrenByParent.get(rootPageId) ?? [];

  return (
    <div className={className}>
      <div className="space-y-1">
        {rootChildIds.map((pageId) => renderNode(pageId, 0))}
      </div>
    </div>
  );
}
