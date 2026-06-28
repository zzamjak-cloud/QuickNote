// 모바일 전용 카드 리스트 — 테이블 뷰가 좁은 화면에서 가로로 넘치는 대신 행을 카드로 표시.
// 테이블의 표시 컬럼(getVisibleOrderedColumns "table")을 그대로 따르며, 탭하면 행 상세(RowPeek)를 연다.
// 표시 전용(DatabaseCellDisplay) — 인라인 편집은 행 상세에서.
import { useMemo } from "react";
import {
  getVisibleOrderedColumns,
  isInternalHiddenColumnId,
  type DatabasePanelState,
} from "../../../types/database";
import { useProcessedRows } from "../useProcessedRows";
import { useDatabaseStore } from "../../../store/databaseStore";
import { DatabaseCellDisplay } from "../DatabaseCellDisplay";
import {
  databaseCellHasDisplayValue,
  databaseColumnMayHaveDerivedDisplayValue,
} from "../databaseCellDisplayUtils";
import { useOpenDatabaseRow } from "../useOpenDatabaseRow";
import { PageIconDisplay } from "../../common/PageIconDisplay";
import { useRowGroups } from "../useRowGroups";
import { GroupSectionHeader } from "../GroupSectionHeader";
import { useDatabaseGroupCollapseStore } from "../../../store/databaseGroupCollapseStore";
import type { DatabaseRowView, ColumnDef } from "../../../types/database";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState?: (p: Partial<DatabasePanelState>) => void;
  visibleRowLimit?: number;
};

export function DatabaseCardListView({
  databaseId,
  panelState,
  visibleRowLimit,
}: Props) {
  const { rows: allRows } = useProcessedRows(databaseId, panelState);
  const columns = useDatabaseStore((s) => s.databases[databaseId]?.columns);
  const openRow = useOpenDatabaseRow(databaseId);
  const isCollapsed = useDatabaseGroupCollapseStore((s) => s.isCollapsed);
  const toggleCollapsed = useDatabaseGroupCollapseStore((s) => s.toggle);

  const rows = useMemo(
    () =>
      visibleRowLimit != null
        ? (allRows ?? []).slice(0, visibleRowLimit)
        : (allRows ?? []),
    [allRows, visibleRowLimit],
  );

  const propertyCols = useMemo(
    () =>
      getVisibleOrderedColumns(columns ?? [], "table", panelState.viewConfigs).filter(
        (c) => c.type !== "title" && !isInternalHiddenColumnId(c.id),
      ),
    [columns, panelState.viewConfigs],
  );

  // 표시설정의 그룹화(groupByColumnId)를 카드 리스트에도 반영. null 이면 평면 리스트.
  const groups = useRowGroups(rows, columns ?? [], panelState.groupByColumnId);

  const renderCard = (row: DatabaseRowView) => {
    const cells = row.cells ?? {};
    const shownCols = propertyCols.filter(
      (col: ColumnDef) =>
        databaseCellHasDisplayValue(cells[col.id], col) ||
        databaseColumnMayHaveDerivedDisplayValue(col),
    );
    return (
      <button
        key={row.pageId}
        type="button"
        onClick={() =>
          void openRow(row.pageId, { source: "database-card-row-open" })
        }
        className="flex w-full flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-left active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
      >
        <div className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
          <PageIconDisplay icon={row.icon ?? null} size="sm" className="shrink-0" />
          <span className="min-w-0 truncate">{row.title || "제목 없음"}</span>
        </div>
        {shownCols.length > 0 && (
          <div className="flex flex-col gap-1">
            {shownCols.map((col) => (
              <div key={col.id} className="flex items-start gap-2 text-sm">
                <span className="w-24 shrink-0 truncate text-xs text-zinc-400">
                  {col.name}
                </span>
                <span className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
                  <DatabaseCellDisplay
                    column={col}
                    value={cells[col.id]}
                    rowId={row.pageId}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </button>
    );
  };

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-zinc-400">
        행이 없습니다.
      </p>
    );
  }

  // 그룹화 활성: 그룹별 섹션(접기 가능)으로 카드 묶음 표시.
  if (groups) {
    return (
      <div className="flex flex-col gap-4 px-3 py-2">
        {groups.map((group) => {
          const collapsed = isCollapsed(databaseId, "table", group.key);
          return (
            <div key={group.key} className="flex flex-col gap-2">
              <GroupSectionHeader
                label={group.label}
                collapsed={collapsed}
                onToggle={() => toggleCollapsed(databaseId, "table", group.key)}
              />
              {!collapsed && (
                <div className="flex flex-col gap-2">
                  {group.rows.map(renderCard)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">{rows.map(renderCard)}</div>
  );
}
