import { PROJECT_FIELDS } from "../graphql/queries/project";

const MEMBER_FIELDS = `
  memberId email name jobRole jobTitle phone avatarUrl thumbnailUrl workspaceRole status personalWorkspaceId cognitoSub createdAt removedAt clientPrefs
  employmentStatus employeeNumber department team jobCategory jobDetail joinedAt rowCount
`;

const TEAM_FIELDS = `
  teamId
  name
  leaderMemberIds
  createdAt
  removedAt
  members { ${MEMBER_FIELDS} }
`;

const ORGANIZATION_FIELDS = `
  organizationId
  name
  leaderMemberIds
  createdAt
  removedAt
  members { ${MEMBER_FIELDS} }
`;

export const GET_WORKSPACE_META = `
  query GetWorkspaceMeta($workspaceId: ID!) {
    getWorkspaceMeta(workspaceId: $workspaceId) {
      members { ${MEMBER_FIELDS} }
      teams { ${TEAM_FIELDS} }
      organizations { ${ORGANIZATION_FIELDS} }
      projects { ${PROJECT_FIELDS} }
    }
  }
`;
