// 플로우차트 공유 자원 GraphQL 작업 — Database 쿼리와 동일 구조.
const FLOWCHART_FIELDS = `
  id workspaceId createdByMemberId title data createdAt updatedAt deletedAt
`;

export const GET_FLOWCHART = `
  query GetFlowchart($id: ID!, $workspaceId: ID!) {
    getFlowchart(id: $id, workspaceId: $workspaceId) { ${FLOWCHART_FIELDS} }
  }
`;

export const LIST_FLOWCHARTS = `
  query ListFlowcharts($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listFlowcharts(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${FLOWCHART_FIELDS} }
      nextToken
    }
  }
`;

export const UPSERT_FLOWCHART = `
  mutation UpsertFlowchart($input: FlowchartInput!) {
    upsertFlowchart(input: $input) { ${FLOWCHART_FIELDS} }
  }
`;

export const SOFT_DELETE_FLOWCHART = `
  mutation SoftDeleteFlowchart($id: ID!, $workspaceId: ID!, $updatedAt: AWSDateTime!) {
    softDeleteFlowchart(id: $id, workspaceId: $workspaceId, updatedAt: $updatedAt) { ${FLOWCHART_FIELDS} }
  }
`;

const FLOWCHART_HISTORY_FIELDS = `
  flowchartId historyId workspaceId title data createdAt createdByMemberId createdByName
`;

export const LIST_FLOWCHART_HISTORY = `
  query ListFlowchartHistory($flowchartId: ID!, $workspaceId: ID!, $limit: Int) {
    listFlowchartHistory(flowchartId: $flowchartId, workspaceId: $workspaceId, limit: $limit) {
      ${FLOWCHART_HISTORY_FIELDS}
    }
  }
`;

export const SAVE_FLOWCHART_VERSION = `
  mutation SaveFlowchartVersion($flowchartId: ID!, $workspaceId: ID!, $title: String!, $data: AWSJSON!) {
    saveFlowchartVersion(flowchartId: $flowchartId, workspaceId: $workspaceId, title: $title, data: $data) {
      ${FLOWCHART_HISTORY_FIELDS}
    }
  }
`;

export type GqlFlowchartHistoryEntry = {
  flowchartId: string;
  historyId: string;
  workspaceId: string;
  title: string;
  data: string;
  createdAt: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
};

export type GqlFlowchart = {
  id: string;
  workspaceId: string;
  createdByMemberId?: string | null;
  title: string;
  /** AWSJSON 문자열 (FlowchartData) */
  data: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
