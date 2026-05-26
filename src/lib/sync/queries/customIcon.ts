// 워크스페이스 공유 커스텀 아이콘 GraphQL operations.

const CUSTOM_ICON_FIELDS = `
  id workspaceId src label createdAt createdByMemberId
`;

export const LIST_CUSTOM_ICONS = `
  query ListCustomIcons($workspaceId: ID!) {
    listCustomIcons(workspaceId: $workspaceId) { ${CUSTOM_ICON_FIELDS} }
  }
`;

export const CREATE_CUSTOM_ICON = `
  mutation CreateCustomIcon($input: CustomIconInput!) {
    createCustomIcon(input: $input) { ${CUSTOM_ICON_FIELDS} }
  }
`;

export const DELETE_CUSTOM_ICON = `
  mutation DeleteCustomIcon($id: ID!, $workspaceId: ID!) {
    deleteCustomIcon(id: $id, workspaceId: $workspaceId) { ${CUSTOM_ICON_FIELDS} }
  }
`;

export const ON_CUSTOM_ICON_CHANGED = `
  subscription OnCustomIconChanged($workspaceId: ID!) {
    onCustomIconChanged(workspaceId: $workspaceId) { ${CUSTOM_ICON_FIELDS} }
  }
`;

export type GqlCustomIcon = {
  id: string;
  workspaceId: string;
  src: string;
  label: string;
  createdAt: string;
  createdByMemberId: string | null;
};
