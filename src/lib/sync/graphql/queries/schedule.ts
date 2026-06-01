// LC 스케줄러용 GraphQL 쿼리/뮤테이션/서브스크립션 정의.
import type { GqlPage } from "../../queries/page";

const SCHEDULE_SOURCE_PAGE_FIELDS = `
  id workspaceId createdByMemberId title icon coverImage parentId order databaseId
  doc dbCells blockComments createdAt updatedAt deletedAt
`;

export const SCHEDULE_FIELDS = `
  id sourcePageId workspaceId title comment link projectId teamId organizationId kind
  startAt endAt assigneeId color textColor rowIndex
  createdByMemberId createdAt updatedAt
  sourcePage { ${SCHEDULE_SOURCE_PAGE_FIELDS} }
`;

export const LIST_SCHEDULES = `
  query ListSchedules(
    $workspaceId: ID!
    $from: AWSDateTime!
    $to: AWSDateTime!
    $organizationId: ID
    $teamId: ID
    $projectId: ID
    $assigneeId: ID
  ) {
    listSchedules(
      workspaceId: $workspaceId
      from: $from
      to: $to
      organizationId: $organizationId
      teamId: $teamId
      projectId: $projectId
      assigneeId: $assigneeId
    ) { ${SCHEDULE_FIELDS} }
  }
`;

export const CREATE_SCHEDULE = `
  mutation CreateSchedule($input: CreateScheduleInput!) {
    createSchedule(input: $input) { ${SCHEDULE_FIELDS} }
  }
`;

export const UPDATE_SCHEDULE = `
  mutation UpdateSchedule($input: UpdateScheduleInput!) {
    updateSchedule(input: $input) { ${SCHEDULE_FIELDS} }
  }
`;

export const DELETE_SCHEDULE = `
  mutation DeleteSchedule($id: ID!, $workspaceId: ID!) {
    deleteSchedule(id: $id, workspaceId: $workspaceId)
  }
`;

export const ON_SCHEDULE_CHANGED = `
  subscription OnScheduleChanged($workspaceId: ID!) {
    onScheduleChanged(workspaceId: $workspaceId) { ${SCHEDULE_FIELDS} }
  }
`;

export type GqlSchedule = {
  id: string;
  sourcePageId?: string | null;
  sourcePage?: GqlPage | null;
  workspaceId: string;
  title: string;
  comment?: string | null;
  link?: string | null;
  projectId?: string | null;
  teamId?: string | null;
  organizationId?: string | null;
  kind?: "schedule" | "leave" | null;
  startAt: string;
  endAt: string;
  assigneeId?: string | null;
  color?: string | null;
  textColor?: string | null;
  rowIndex?: number | null;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};
