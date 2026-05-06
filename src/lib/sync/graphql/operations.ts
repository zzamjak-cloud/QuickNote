// 수동 작성 GraphQL operations. infra/lib/sync/schema.graphql 와 일관성 유지.

const PAGE_FIELDS = `
  id ownerId title icon parentId order databaseId
  doc dbCells createdAt updatedAt deletedAt
`;
const DATABASE_FIELDS = `
  id ownerId title columns createdAt updatedAt deletedAt
`;
const CONTACT_FIELDS = `
  id ownerId email displayName createdAt updatedAt deletedAt
`;
const IMAGE_ASSET_FIELDS = `
  id ownerId mimeType size sha256 status createdAt
`;

// Queries
export const LIST_PAGES = `
  query ListPages($updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listPages(updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_FIELDS} }
      nextToken
    }
  }
`;
export const LIST_DATABASES = `
  query ListDatabases($updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listDatabases(updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${DATABASE_FIELDS} }
      nextToken
    }
  }
`;
export const LIST_CONTACTS = `
  query ListContacts($limit: Int, $nextToken: String) {
    listContacts(limit: $limit, nextToken: $nextToken) {
      items { ${CONTACT_FIELDS} }
      nextToken
    }
  }
`;
export const GET_IMAGE_DOWNLOAD_URL = `
  query GetImageDownloadUrl($imageId: ID!) {
    getImageDownloadUrl(imageId: $imageId)
  }
`;

// Mutations
export const UPSERT_PAGE = `
  mutation UpsertPage($input: PageInput!) {
    upsertPage(input: $input) { ${PAGE_FIELDS} }
  }
`;
export const UPSERT_DATABASE = `
  mutation UpsertDatabase($input: DatabaseInput!) {
    upsertDatabase(input: $input) { ${DATABASE_FIELDS} }
  }
`;
export const UPSERT_CONTACT = `
  mutation UpsertContact($input: ContactInput!) {
    upsertContact(input: $input) { ${CONTACT_FIELDS} }
  }
`;
export const SOFT_DELETE_PAGE = `
  mutation SoftDeletePage($id: ID!, $updatedAt: AWSDateTime!) {
    softDeletePage(id: $id, updatedAt: $updatedAt) { ${PAGE_FIELDS} }
  }
`;
export const SOFT_DELETE_DATABASE = `
  mutation SoftDeleteDatabase($id: ID!, $updatedAt: AWSDateTime!) {
    softDeleteDatabase(id: $id, updatedAt: $updatedAt) { ${DATABASE_FIELDS} }
  }
`;
export const SOFT_DELETE_CONTACT = `
  mutation SoftDeleteContact($id: ID!, $updatedAt: AWSDateTime!) {
    softDeleteContact(id: $id, updatedAt: $updatedAt) { ${CONTACT_FIELDS} }
  }
`;
export const GET_IMAGE_UPLOAD_URL = `
  mutation GetImageUploadUrl($input: ImageUploadInput!) {
    getImageUploadUrl(input: $input) { imageId uploadUrl expiresAt }
  }
`;
export const CONFIRM_IMAGE = `
  mutation ConfirmImage($imageId: ID!) {
    confirmImage(imageId: $imageId) { ${IMAGE_ASSET_FIELDS} }
  }
`;

// Subscriptions
export const ON_PAGE_CHANGED = `
  subscription OnPageChanged($ownerId: ID!) {
    onPageChanged(ownerId: $ownerId) { ${PAGE_FIELDS} }
  }
`;
export const ON_DATABASE_CHANGED = `
  subscription OnDatabaseChanged($ownerId: ID!) {
    onDatabaseChanged(ownerId: $ownerId) { ${DATABASE_FIELDS} }
  }
`;
export const ON_CONTACT_CHANGED = `
  subscription OnContactChanged($ownerId: ID!) {
    onContactChanged(ownerId: $ownerId) { ${CONTACT_FIELDS} }
  }
`;

// 모델 타입 (스토어와 호환)
export type GqlPage = {
  id: string;
  ownerId: string;
  title: string;
  icon?: string | null;
  parentId?: string | null;
  order: string;
  databaseId?: string | null;
  doc: unknown;
  dbCells?: unknown | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
export type GqlDatabase = {
  id: string;
  ownerId: string;
  title: string;
  columns: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
export type GqlContact = {
  id: string;
  ownerId: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
export type GqlImageAsset = {
  id: string;
  ownerId: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: "PENDING" | "READY";
  createdAt: string;
};
