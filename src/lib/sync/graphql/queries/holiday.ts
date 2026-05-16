// LC 스케줄러 공휴일용 GraphQL 쿼리/뮤테이션/서브스크립션 정의.
export const HOLIDAY_FIELDS = `
  id workspaceId title date type color
  createdByMemberId createdAt updatedAt
`;

export const LIST_HOLIDAYS = `
  query ListHolidays($workspaceId: ID!) {
    listHolidays(workspaceId: $workspaceId) { ${HOLIDAY_FIELDS} }
  }
`;

export const CREATE_HOLIDAY = `
  mutation CreateHoliday($input: CreateHolidayInput!) {
    createHoliday(input: $input) { ${HOLIDAY_FIELDS} }
  }
`;

export const UPDATE_HOLIDAY = `
  mutation UpdateHoliday($input: UpdateHolidayInput!) {
    updateHoliday(input: $input) { ${HOLIDAY_FIELDS} }
  }
`;

export const DELETE_HOLIDAY = `
  mutation DeleteHoliday($id: ID!, $workspaceId: ID!) {
    deleteHoliday(id: $id, workspaceId: $workspaceId)
  }
`;

export const ON_HOLIDAY_CHANGED = `
  subscription OnHolidayChanged($workspaceId: ID!) {
    onHolidayChanged(workspaceId: $workspaceId) { ${HOLIDAY_FIELDS} }
  }
`;

export type GqlHoliday = {
  id: string;
  workspaceId: string;
  title: string;
  date: string;
  type: string;
  color: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};
