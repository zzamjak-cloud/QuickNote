// 수동 작성 GraphQL operations. infra/lib/sync/schema.graphql 와 일관성 유지.
export {
  LIST_PAGES,
  LIST_TRASHED_PAGES,
  ON_PAGE_CHANGED,
  RESTORE_PAGE,
  SOFT_DELETE_PAGE,
  UPSERT_PAGE,
  type GqlPage,
} from "../queries/page";
export {
  LIST_DATABASES,
  ON_DATABASE_CHANGED,
  SOFT_DELETE_DATABASE,
  UPSERT_DATABASE,
  type GqlDatabase,
} from "../queries/database";

const IMAGE_ASSET_FIELDS = `
  id ownerId mimeType size sha256 status createdAt
`;

export const GET_IMAGE_DOWNLOAD_URL = `
  query GetImageDownloadUrl($imageId: ID!) {
    getImageDownloadUrl(imageId: $imageId)
  }
`;

// Mutations
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
// 모델 타입 (스토어와 호환)
export type GqlImageAsset = {
  id: string;
  ownerId: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: "PENDING" | "READY";
  createdAt: string;
};

export {
  LIST_SCHEDULES,
  CREATE_SCHEDULE,
  UPDATE_SCHEDULE,
  DELETE_SCHEDULE,
  ON_SCHEDULE_CHANGED,
  type GqlSchedule,
} from "./queries/schedule";
export {
  LIST_PROJECTS,
  CREATE_PROJECT,
  UPDATE_PROJECT,
  DELETE_PROJECT,
  ON_PROJECT_CHANGED,
  type GqlProject,
} from "./queries/project";
export {
  LIST_HOLIDAYS,
  CREATE_HOLIDAY,
  UPDATE_HOLIDAY,
  DELETE_HOLIDAY,
  ON_HOLIDAY_CHANGED,
  type GqlHoliday,
} from "./queries/holiday";
