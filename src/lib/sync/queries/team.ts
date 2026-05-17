const TEAM_FIELDS = `
  teamId
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

export const LIST_TEAMS = `
  query ListTeams {
    listTeams { ${TEAM_FIELDS} }
  }
`;

export const GET_TEAM = `
  query GetTeam($teamId: ID!) {
    getTeam(teamId: $teamId) { ${TEAM_FIELDS} }
  }
`;

export const CREATE_TEAM = `
  mutation CreateTeam($name: String!) {
    createTeam(name: $name) { ${TEAM_FIELDS} }
  }
`;

export const DELETE_TEAM = `
  mutation DeleteTeam($teamId: ID!) {
    deleteTeam(teamId: $teamId)
  }
`;

export const UPDATE_TEAM = `
  mutation UpdateTeam($teamId: ID!, $name: String, $leaderMemberIds: [ID!]) {
    updateTeam(teamId: $teamId, name: $name, leaderMemberIds: $leaderMemberIds) { ${TEAM_FIELDS} }
  }
`;

export const ARCHIVE_TEAM = `
  mutation ArchiveTeam($teamId: ID!) {
    archiveTeam(teamId: $teamId) { ${TEAM_FIELDS} }
  }
`;

export const RESTORE_TEAM = `
  mutation RestoreTeam($teamId: ID!) {
    restoreTeam(teamId: $teamId) { ${TEAM_FIELDS} }
  }
`;
