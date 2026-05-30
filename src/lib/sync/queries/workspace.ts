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
  removedAt
  access { ${ACCESS_ENTRY_FIELDS} }
  options { jobFunctions jobTitles }
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

// 접근권한 변경 실시간 트리거. myEffectiveLevel 은 변경 호출자 기준으로 푸시되므로 신뢰하지 않고,
// 신호 수신 시 클라이언트가 워크스페이스를 재페치해 각자 본인 기준 권한을 갱신한다.
export const ON_WORKSPACE_CHANGED = `
  subscription OnWorkspaceChanged($workspaceId: ID!) {
    onWorkspaceChanged(workspaceId: $workspaceId) { workspaceId }
  }
`;

export const DELETE_WORKSPACE = `
  mutation DeleteWorkspace($workspaceId: ID!) {
    deleteWorkspace(workspaceId: $workspaceId)
  }
`;

export const ARCHIVE_WORKSPACE = `
  mutation ArchiveWorkspace($workspaceId: ID!) {
    archiveWorkspace(workspaceId: $workspaceId) { ${WORKSPACE_FIELDS} }
  }
`;

export const RESTORE_WORKSPACE = `
  mutation RestoreWorkspace($workspaceId: ID!) {
    restoreWorkspace(workspaceId: $workspaceId) { ${WORKSPACE_FIELDS} }
  }
`;
