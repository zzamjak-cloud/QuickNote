import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ColumnDef, DatabaseRowView } from "../../types/database";
import { buildRowGroups, isGroupableColumn, type RowGroup } from "../../lib/database/grouping";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import {
  collectDatabaseDependencyIds,
  collectPageDependencyIds,
} from "./databaseQueryDependencies";
import {
  createDatabaseDependencyMapSelector,
  createPageDependencyMapSelector,
} from "./renderScopeSelectors";

const EMPTY_GROUP_COLUMNS: readonly ColumnDef[] = [];

/**
 * 그룹화 설정에 따라 행을 그룹으로 분할한다.
 * - groupByColumnId 가 없거나·삭제됨·그룹화 불가 타입이면 null 반환 → 호출 뷰는 기존 평면 렌더 유지.
 * - 그룹화 라벨/색 해석에 필요한 store 들을 한곳에서 읽어 각 뷰 컴포넌트를 단순하게 유지한다.
 */
export function useRowGroups(
  rows: DatabaseRowView[],
  columns: ColumnDef[],
  groupByColumnId: string | null | undefined,
): RowGroup[] | null {
  const members = useMemberStore((s) => s.members);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);

  const groupCol = useMemo(() => {
    if (!groupByColumnId) return null;
    const col = columns.find((c) => c.id === groupByColumnId);
    return col && isGroupableColumn(col) ? col : null;
  }, [columns, groupByColumnId]);
  const dependencyColumns = useMemo(
    () => (groupCol ? [groupCol] : EMPTY_GROUP_COLUMNS),
    [groupCol],
  );
  const databaseDependencyIds = useMemo(
    () => collectDatabaseDependencyIds(null, dependencyColumns, rows),
    [dependencyColumns, rows],
  );
  const databaseDependenciesSelector = useMemo(
    () => createDatabaseDependencyMapSelector(databaseDependencyIds),
    [databaseDependencyIds],
  );
  const databases = useDatabaseStore(useShallow(databaseDependenciesSelector));
  const pageDependencyIds = useMemo(
    () =>
      groupCol
        ? collectPageDependencyIds(rows, dependencyColumns, databases)
        : [],
    [groupCol, rows, dependencyColumns, databases],
  );
  const pageDependenciesSelector = useMemo(
    () => createPageDependencyMapSelector(pageDependencyIds),
    [pageDependencyIds],
  );
  const pages = usePageStore(useShallow(pageDependenciesSelector));

  return useMemo(() => {
    if (!groupCol) return null;
    return buildRowGroups(rows, groupCol, {
      databases,
      pages,
      members,
      scopeCtx: { organizations, teams, projects },
    });
  }, [groupCol, rows, databases, pages, members, organizations, teams, projects]);
}
