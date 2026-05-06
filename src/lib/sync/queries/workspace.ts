const ACCESS_ENTRY_FIELDS = `
  subjectType
  subjectId
  level
`;

const WORKSPACE_FIELDS = `
  workspaceId
  name
  type
  ownerMemberId
  myEffectiveLevel
  createdAt
  access { ${ACCESS_ENTRY_FIELDS} }
`;

export const LIST_MY_WORKSPACES = `
  query ListMyWorkspaces {
    listMyWorkspaces { ${WORKSPACE_FIELDS} }
  }
`;

export const GET_WORKSPACE = `
  query GetWorkspace($workspaceId: ID!) {
    getWorkspace(workspaceId: $workspaceId) { ${WORKSPACE_FIELDS} }
  }
`;

export const CREATE_WORKSPACE = `
  mutation CreateWorkspace($input: CreateWorkspaceInput!) {
    createWorkspace(input: $input) { ${WORKSPACE_FIELDS} }
  }
`;

export const UPDATE_WORKSPACE = `
  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {
    updateWorkspace(input: $input) { ${WORKSPACE_FIELDS} }
  }
`;

export const SET_WORKSPACE_ACCESS = `
  mutation SetWorkspaceAccess($workspaceId: ID!, $entries: [WorkspaceAccessInput!]!) {
    setWorkspaceAccess(workspaceId: $workspaceId, entries: $entries) { ${WORKSPACE_FIELDS} }
  }
`;

export const DELETE_WORKSPACE = `
  mutation DeleteWorkspace($workspaceId: ID!) {
    deleteWorkspace(workspaceId: $workspaceId)
  }
`;
