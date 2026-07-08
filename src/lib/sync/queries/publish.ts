// 페이지 웹 게시(publish to web) GraphQL 쿼리/뮤테이션.

const PUBLISH_STATUS_FIELDS = `
  pageId workspaceId published token publishedAt
`;

export const GET_PAGE_PUBLISH_STATUS = `
  query GetPagePublishStatus($pageId: ID!) {
    getPagePublishStatus(pageId: $pageId) { ${PUBLISH_STATUS_FIELDS} }
  }
`;

export const PUBLISH_PAGE = `
  mutation PublishPage($pageId: ID!) {
    publishPage(pageId: $pageId) { ${PUBLISH_STATUS_FIELDS} }
  }
`;

export const UNPUBLISH_PAGE = `
  mutation UnpublishPage($pageId: ID!) {
    unpublishPage(pageId: $pageId) { ${PUBLISH_STATUS_FIELDS} }
  }
`;
