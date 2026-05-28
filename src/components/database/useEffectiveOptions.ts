// useEffectiveOptions — select/multiSelect/status 컬럼에 적용될 최종 옵션 목록을 구독.
// linkedScope (organization/team/project) 가 설정된 컬럼은 해당 store 의 데이터를 옵션화한다.

import { useMemo } from "react";
import type { ColumnDef, SelectOption } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { effectiveOptions } from "../../lib/database/columnSource";

export function useEffectiveOptions(column: ColumnDef): SelectOption[] {
  const databases = useDatabaseStore((s) => s.databases);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  return useMemo(
    () => effectiveOptions(column, databases, { organizations, teams, projects }),
    [column, databases, organizations, teams, projects],
  );
}
