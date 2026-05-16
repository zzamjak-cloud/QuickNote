// LC 스케줄러용 GraphQL 쿼리/뮤테이션/서브스크립션 정의.
export const SCHEDULE_FIELDS = `
  id workspaceId title comment link projectId
  startAt endAt assigneeId color textColor rowIndex
  createdByMemberId createdAt updatedAt
`;

export const LIST_SCHEDULES = `
  query ListSchedules($workspaceId: ID!, $from: AWSDateTime!, $to: AWSDateTime!) {
    listSchedules(workspaceId: $workspaceId, from: $from, to: $to) { ${SCHEDULE_FIELDS} }
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
  workspaceId: string;
  title: string;
  comment?: string | null;
  link?: string | null;
  projectId?: string | null;
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
