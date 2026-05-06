const TEAM_FIELDS = `
  teamId
  name
  createdAt
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
