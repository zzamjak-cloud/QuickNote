import { gqlOptional } from "./graphqlRequest";
import { LIST_SCHEDULES, type GqlSchedule } from "./graphql/operations";
import type { GqlPage } from "./queries/page";

export type ScheduleRangeRequest = {
  workspaceId: string;
  from: string;
  to: string;
  organizationId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
};

export function extractScheduleRangeSourcePages(schedules: GqlSchedule[]): GqlPage[] {
  const pages: GqlPage[] = [];
  const seen = new Set<string>();
  for (const schedule of schedules) {
    const page = schedule.sourcePage;
    if (!page?.id || seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
  }
  return pages;
}

export async function fetchScheduleRange(request: ScheduleRangeRequest): Promise<GqlSchedule[]> {
  const schedules = await gqlOptional<GqlSchedule[]>(
    LIST_SCHEDULES,
    {
      workspaceId: request.workspaceId,
      from: request.from,
      to: request.to,
      organizationId: request.organizationId ?? undefined,
      teamId: request.teamId ?? undefined,
      projectId: request.projectId ?? undefined,
      assigneeId: request.assigneeId ?? undefined,
    },
    "listSchedules",
  );

  return schedules ?? [];
}
