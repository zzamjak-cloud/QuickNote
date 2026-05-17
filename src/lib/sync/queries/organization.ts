// 조직(실) GraphQL 쿼리/뮤테이션 — team 쿼리와 동일 패턴

const ORGANIZATION_FIELDS = `
  organizationId
  name
  leaderMemberIds
  createdAt
  removedAt
  members {
    memberId
    email
    name
    jobRole
    workspaceRole
    status
    personalWorkspaceId
    cognitoSub
    createdAt
    removedAt
  }
`;

export const LIST_ORGANIZATIONS = `
  query ListOrganizations {
    listOrganizations { ${ORGANIZATION_FIELDS} }
  }
`;

export const CREATE_ORGANIZATION = `
  mutation CreateOrganization($name: String!) {
    createOrganization(name: $name) { ${ORGANIZATION_FIELDS} }
  }
`;

export const UPDATE_ORGANIZATION = `
  mutation UpdateOrganization($organizationId: ID!, $name: String, $leaderMemberIds: [ID!]) {
    updateOrganization(organizationId: $organizationId, name: $name, leaderMemberIds: $leaderMemberIds) { ${ORGANIZATION_FIELDS} }
  }
`;

export const DELETE_ORGANIZATION = `
  mutation DeleteOrganization($organizationId: ID!) {
    deleteOrganization(organizationId: $organizationId)
  }
`;

export const ASSIGN_MEMBER_TO_ORGANIZATION = `
  mutation AssignMemberToOrganization($memberId: ID!, $organizationId: ID!) {
    assignMemberToOrganization(memberId: $memberId, organizationId: $organizationId)
  }
`;

export const UNASSIGN_MEMBER_FROM_ORGANIZATION = `
  mutation UnassignMemberFromOrganization($memberId: ID!, $organizationId: ID!) {
    unassignMemberFromOrganization(memberId: $memberId, organizationId: $organizationId)
  }
`;

export const ARCHIVE_ORGANIZATION = `
  mutation ArchiveOrganization($organizationId: ID!) {
    archiveOrganization(organizationId: $organizationId) { ${ORGANIZATION_FIELDS} }
  }
`;

export const RESTORE_ORGANIZATION = `
  mutation RestoreOrganization($organizationId: ID!) {
    restoreOrganization(organizationId: $organizationId) { ${ORGANIZATION_FIELDS} }
  }
`;
