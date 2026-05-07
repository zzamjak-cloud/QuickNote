const MEMBER_FIELDS = `
  memberId email name jobRole jobTitle phone avatarUrl thumbnailUrl workspaceRole status personalWorkspaceId cognitoSub createdAt removedAt
`;

export const ME = `
  query Me {
    me { ${MEMBER_FIELDS} }
  }
`;

export const LIST_MEMBERS = `
  query ListMembers($filter: MemberFilter) {
    listMembers(filter: $filter) { ${MEMBER_FIELDS} }
  }
`;

export const GET_MEMBER = `
  query GetMember($memberId: ID!) {
    getMember(memberId: $memberId) { ${MEMBER_FIELDS} }
  }
`;

export const CREATE_MEMBER = `
  mutation CreateMember($input: CreateMemberInput!) {
    createMember(input: $input) { ${MEMBER_FIELDS} }
  }
`;

export const PROMOTE_TO_MANAGER = `
  mutation PromoteToManager($memberId: ID!) {
    promoteToManager(memberId: $memberId) { ${MEMBER_FIELDS} }
  }
`;

export const DEMOTE_TO_MEMBER = `
  mutation DemoteToMember($memberId: ID!) {
    demoteToMember(memberId: $memberId) { ${MEMBER_FIELDS} }
  }
`;

export const REMOVE_MEMBER = `
  mutation RemoveMember($memberId: ID!) {
    removeMember(memberId: $memberId) { ${MEMBER_FIELDS} }
  }
`;

export const ASSIGN_MEMBER_TO_TEAM = `
  mutation AssignMemberToTeam($memberId: ID!, $teamId: ID!) {
    assignMemberToTeam(memberId: $memberId, teamId: $teamId)
  }
`;

export const UNASSIGN_MEMBER_FROM_TEAM = `
  mutation UnassignMemberFromTeam($memberId: ID!, $teamId: ID!) {
    unassignMemberFromTeam(memberId: $memberId, teamId: $teamId)
  }
`;

export const SEARCH_MEMBERS_FOR_MENTION = `
  query SearchMembersForMention($query: String, $limit: Int) {
    searchMembersForMention(query: $query, limit: $limit) {
      memberId
      name
      jobRole
    }
  }
`;

export const UPDATE_MEMBER = `
  mutation UpdateMember(
    $memberId: ID!
    $name: String
    $jobRole: String
    $jobTitle: String
    $phone: String
    $avatarUrl: String
    $thumbnailUrl: String
  ) {
    updateMember(
      memberId: $memberId
      input: {
        name: $name
        jobRole: $jobRole
        jobTitle: $jobTitle
        phone: $phone
        avatarUrl: $avatarUrl
        thumbnailUrl: $thumbnailUrl
      }
    ) { ${MEMBER_FIELDS} }
  }
`;
