import { useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { getVisibleOrderedColumns } from "../../../types/database";
import type { DatabasePanelState, DatabaseRowView } from "../../../types/database";
import { useProcessedRows } from "../useProcessedRows";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseGroupCollapseStore } from "../../../store/databaseGroupCollapseStore";
import {
  databasePageTreeCollapseKey,
  useDatabasePageTreeCollapseStore,
} from "../../../store/databasePageTreeCollapseStore";
import { useUiStore } from "../../../store/uiStore";
import { resolveActiveFilterRules } from "../../../lib/databaseQuery";
import { IconPicker } from "../../common/IconPicker";
import { useWindowedRows } from "./useWindowedRows";
import { useRowGroups } from "../useRowGroups";
import { GroupSectionHeader } from "../GroupSectionHeader";
import {
  DatabaseCellDisplay,
} from "../DatabaseCellDisplay";
import {
  databaseCellHasDisplayValue,
  databaseColumnMayHaveDerivedDisplayValue,
} from "../databaseCellDisplayUtils";
import { useAddDatabaseRowAndOpen, useOpenDatabaseRow } from "../useOpenDatabaseRow";
import { DatabasePageSubtree } from "../DatabasePageSubtree";
import {
  collectPageTreePath,
  countPageDescendants,
} from "../../page/pageSubpageTreeUtils";
import { useOpenPageInPeek } from "../../page/useOpenPageInPeek";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  visibleRowLimit?: number;
};

function DatabaseListRow({
  databaseId,
  row,
  extraCols,
  openRow,
}: {
  databaseId: string;
  row: DatabaseRowView;
  extraCols: ReturnType<typeof getVisibleOrderedColumns>;
  openRow: ReturnType<typeof useOpenDatabaseRow>;
}) {
  const setIcon = usePageStore((s) => s.setIcon);
  const createPage = usePageStore((s) => s.createPage);
  const pages = usePageStore((s) => s.pages);
  const pageDescendantCount = usePageStore((s) => countPageDescendants(row.pageId, s.pages));
  const rootTreeCollapsed = useDatabasePageTreeCollapseStore((s) =>
    pageDescendantCount > 0
      ? s.collapsedByKey[databasePageTreeCollapseKey(databaseId, row.pageId)] !== false
      : false,
  );
  const setTreeCollapsed = useDatabasePageTreeCollapseStore((s) => s.setCollapsed);
  const toggleTreeCollapsed = useDatabasePageTreeCollapseStore((s) => s.toggle);
  const focusRequest = useUiStore((s) => s.databaseTreeFocusRequest);
  const requestDatabaseTreeFocus = useUiStore((s) => s.requestDatabaseTreeFocus);
  const openPageInPeek = useOpenPageInPeek();
  const title = row.title || "제목 없음";
  const hasPageTree = pageDescendantCount > 0;

  const createChildPage = (target: HTMLElement) => {
    const newPageId = createPage("새 페이지", row.pageId, { activate: false });
    requestDatabaseTreeFocus(databaseId, newPageId);
    setTreeCollapsed(databaseId, row.pageId, false);
    void openPageInPeek(newPageId, {
      navigateInPeek: Boolean(target.closest("[data-qn-peek-editor='true']")),
      source: "database-list-create-child-page",
    });
  };

  useEffect(() => {
    if (!focusRequest || focusRequest.databaseId !== databaseId) return;
    if (collectPageTreePath(focusRequest.pageId, pages, row.pageId).length === 0) return;
    setTreeCollapsed(databaseId, row.pageId, false);
  }, [databaseId, focusRequest, pages, row.pageId, setTreeCollapsed]);

  return (
    <div
      key={row.pageId}
      onClick={() => void openRow(row.pageId, { source: "database-list-row-open" })}
      className="cursor-pointer rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
    >
      <div className="group/tree flex min-w-0 items-center gap-2">
        {hasPageTree ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleTreeCollapsed(databaseId, row.pageId);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label={rootTreeCollapsed ? "하위 페이지 펼치기" : "하위 페이지 접기"}
          >
            {rootTreeCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="block h-5 w-5 shrink-0" aria-hidden />
        )}
        <span
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <IconPicker
            current={row.icon ?? null}
            size="md"
            onChange={(icon) => setIcon(row.pageId, icon)}
          />
        </span>
        <button
          type="button"
          data-qn-page-tree-node={row.pageId}
          onClick={(event) => {
            event.stopPropagation();
            const inPeek = Boolean(
              event.currentTarget.closest("[data-qn-peek-editor='true']"),
            );
            void openRow(row.pageId, {
              source: "database-list-row-open",
              navigateInPeek: inPeek,
            });
          }}
          className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {title}
        </button>
        {extraCols.map((col) => {
          const cell = row.cells[col.id];
          if (!databaseCellHasDisplayValue(cell, col) && !databaseColumnMayHaveDerivedDisplayValue(col)) return null;
          return (
            <span key={col.id} className="shrink-0 truncate text-sm">
              <DatabaseCellDisplay column={col} value={cell} rowId={row.pageId} />
            </span>
          );
        })}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            createChildPage(event.currentTarget);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover/tree:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="하위 페이지 추가"
          title="하위 페이지 추가"
        >
          <Plus size={13} />
        </button>
      </div>
      {hasPageTree && !rootTreeCollapsed && (
        <DatabasePageSubtree
          databaseId={databaseId}
          rootPageId={row.pageId}
          className="pt-1"
          compact
        />
      )}
    </div>
  );
}

export function DatabaseListView({ databaseId, panelState, visibleRowLimit }: Props) {
  const { bundle, rows: allRows, columns } = useProcessedRows(databaseId, panelState);
  const pages = usePageStore((s) => s.pages);
  const rows = visibleRowLimit != null ? allRows.slice(0, visibleRowLimit) : allRows;

  const openRow = useOpenDatabaseRow(databaseId);
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);
  const groups = useRowGroups(rows, columns, panelState.groupByColumnId);
  const isCollapsed = useDatabaseGroupCollapseStore((s) => s.isCollapsed);
  const toggleCollapsed = useDatabaseGroupCollapseStore((s) => s.toggle);
  const hasPageTreeRows = useMemo(
    () => rows.some((row) => countPageDescendants(row.pageId, pages) > 0),
    [pages, rows],
  );
  const virtualRows = useWindowedRows({
    count: rows.length,
    estimateSize: 34,
    // 그룹화/하위 페이지 트리 활성 시 가상화 비활성(가변 높이 row와 평면 윈도잉이 충돌).
    enabled: !groups && !hasPageTreeRows && visibleRowLimit == null && rows.length > 160,
    overscan: 12,
  });
  const renderedRows = useMemo(
    () =>
      virtualRows.enabled
        ? rows.slice(virtualRows.start, virtualRows.end)
        : rows,
    [rows, virtualRows.enabled, virtualRows.end, virtualRows.start],
  );
  const titleCol = columns.find((c) => c.type === "title");

  // 모든 뷰 공통 규칙 — getVisibleOrderedColumns 결과(설정 없으면 전체 표시)에서 제목만 분리.
  const extraCols = useMemo(
    () =>
      getVisibleOrderedColumns(columns, "list", panelState.viewConfigs).filter(
        (c) => c.id !== titleCol?.id,
      ),
    [columns, panelState.viewConfigs, titleCol?.id],
  );

  if (!bundle) return null;

  const renderRow = (row: DatabaseRowView) => (
    <DatabaseListRow
      key={row.pageId}
      databaseId={databaseId}
      row={row}
      extraCols={extraCols}
      openRow={openRow}
    />
  );

  const addRowButton = (
    <button
      type="button"
      onClick={() =>
        void addRowAndOpen(resolveActiveFilterRules(panelState), {
          source: "database-list-add-row-open",
        })
      }
      className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <Plus size={14} /> 새 항목
    </button>
  );

  // 그룹화 렌더 — 그룹 헤더 + 펼쳐진 그룹 행.
  if (groups) {
    return (
      <div className="pt-2">
        {groups.map((group) => {
          const collapsed = isCollapsed(databaseId, "list", group.key);
          return (
            <div key={group.key} className="mb-6">
              <GroupSectionHeader
                label={group.label}
                collapsed={collapsed}
                onToggle={() => toggleCollapsed(databaseId, "list", group.key)}
              />
              {!collapsed && <div className="mt-1 pl-3">{group.rows.map(renderRow)}</div>}
            </div>
          );
        })}
        {addRowButton}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="pt-2">
        <p className="py-6 text-center text-xs text-zinc-400">항목이 없습니다.</p>
        <button
          type="button"
          onClick={() =>
            void addRowAndOpen(resolveActiveFilterRules(panelState), {
              source: "database-list-add-row-open",
            })
          }
          className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Plus size={14} /> 새 항목
        </button>
      </div>
    );
  }

  return (
    <div ref={virtualRows.containerRef} className="pt-2">
      {virtualRows.topPadding > 0 && (
        <div aria-hidden="true" style={{ height: virtualRows.topPadding }} />
      )}
      {renderedRows.map(renderRow)}
      {virtualRows.bottomPadding > 0 && (
        <div aria-hidden="true" style={{ height: virtualRows.bottomPadding }} />
      )}
      {addRowButton}
    </div>
  );
}
