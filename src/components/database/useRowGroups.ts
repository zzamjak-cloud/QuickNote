import { useMemo } from "react";
import type { ColumnDef, DatabaseRowView } from "../../types/database";
import { buildRowGroups, isGroupableColumn, type RowGroup } from "../../lib/database/grouping";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";

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
  const databases = useDatabaseStore((s) => s.databases);
  const pages = usePageStore((s) => s.pages);
  const members = useMemberStore((s) => s.members);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);

  const groupCol = useMemo(() => {
    if (!groupByColumnId) return null;
    const col = columns.find((c) => c.id === groupByColumnId);
    return col && isGroupableColumn(col) ? col : null;
  }, [columns, groupByColumnId]);

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
