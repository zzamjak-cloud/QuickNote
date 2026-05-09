import type { DatabaseBundle } from "./database";
import type { Page } from "./page";

export const HISTORY_STORE_VERSION = 1;
export const HISTORY_RETENTION_MAX_EVENTS = 200;
export const HISTORY_RETENTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const HISTORY_ANCHOR_INTERVAL = 20;
export const HISTORY_GROUP_WINDOW_MS = 90 * 1000;

export type PageSnapshot = Pick<
  Page,
  "id" | "title" | "icon" | "coverImage" | "doc" | "parentId" | "order" | "databaseId" | "dbCells"
>;

export type DatabaseSnapshot = DatabaseBundle;

export type PageHistoryKind =
  | "page.create"
  | "page.rename"
  | "page.icon"
  | "page.coverImage"
  | "page.doc"
  | "page.move"
  | "page.delete"
  | "page.dbCell";

export type DbHistoryKind =
  | "db.create"
  | "db.delete"
  | "db.title"
  | "db.column.add"
  | "db.column.update"
  | "db.column.remove"
  | "db.column.move"
  | "db.row.add"
  | "db.row.delete"
  | "db.row.order"
  | "db.cell";

export type PageHistoryEvent = {
  id: string;
  ts: number;
  kind: PageHistoryKind;
  pageId: string;
  patch: Partial<PageSnapshot>;
  /** 주기적 압축용 기준 스냅샷 */
  anchor?: PageSnapshot;
  /** 기록 시점 수정 구성원(영속 시점 스냅샷) */
  editedByMemberId?: string;
  editedByName?: string;
};

export type DbHistoryEvent = {
  id: string;
  ts: number;
  kind: DbHistoryKind;
  databaseId: string;
  patch: Partial<DatabaseSnapshot>;
  /** 주기적 압축용 기준 스냅샷 */
  anchor?: DatabaseSnapshot;
};

export type DeletedRowTombstone = {
  id: string;
  ts: number;
  databaseId: string;
  pageId: string;
  rowIndex: number;
  pageSnapshot: PageSnapshot;
};

export type HistoryTimelineEntry = {
  id: string;
  bucket: "content" | "structure";
  representativeKind: PageHistoryKind | DbHistoryKind;
  eventIds: string[];
  startTs: number;
  endTs: number;
  count: number;
  label: string;
  /** 버킷 내 가장 마지막 이벤트의 수정자 */
  lastEditedByMemberId?: string;
  lastEditedByName?: string;
};
