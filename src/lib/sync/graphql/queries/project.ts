// LC 스케줄러 프로젝트용 GraphQL 쿼리/뮤테이션/서브스크립션 정의.
export const PROJECT_FIELDS = `
  id workspaceId name color description memberIds leaderMemberIds isHidden
  createdByMemberId createdAt updatedAt
`;

export const LIST_PROJECTS = `
  query ListProjects($workspaceId: ID!) {
    listProjects(workspaceId: $workspaceId) { ${PROJECT_FIELDS} }
  }
`;

export const CREATE_PROJECT = `
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) { ${PROJECT_FIELDS} }
  }
`;

export const UPDATE_PROJECT = `
  mutation UpdateProject($input: UpdateProjectInput!) {
    updateProject(input: $input) { ${PROJECT_FIELDS} }
  }
`;

export const DELETE_PROJECT = `
  mutation DeleteProject($id: ID!, $workspaceId: ID!) {
    deleteProject(id: $id, workspaceId: $workspaceId)
  }
`;

export const ON_PROJECT_CHANGED = `
  subscription OnProjectChanged($workspaceId: ID!) {
    onProjectChanged(workspaceId: $workspaceId) { ${PROJECT_FIELDS} }
  }
`;

export type GqlProject = {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  description?: string | null;
  memberIds: string[];
  leaderMemberIds: string[];
  isHidden: boolean;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};
