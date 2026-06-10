import type { JSONContent } from "@tiptap/react";
import type { CellValue } from "./database";
import type { PageBlockCommentsSnapshot } from "./blockComment";

export type Page = {
  id: string;
  workspaceId?: string;
  title: string;
  icon: string | null;
  doc: JSONContent;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** 이 페이지가 DB 행이면 소속 데이터베이스 id */
  databaseId?: string;
  /** fullPage 레이아웃 DB 홈 페이지면 연결된 databaseId — doc 로드 없이 메타만으로 식별 가능 */
  fullPageDatabaseId?: string;
  /** title 컬럼을 제외한 셀 값 */
  dbCells?: Record<string, CellValue>;
  /** 커버 이미지 data URL 또는 원격 URL */
  coverImage?: string | null;
  /** 블록 댓글·스레드 읽음 상태 — AppSync `Page.blockComments`(AWSJSON)와 동기화 */
  blockComments?: PageBlockCommentsSnapshot;
  /** 페이지를 생성한 멤버 id — 댓글 알림 수신 대상 판별에 사용 */
  createdByMemberId?: string;
  /** 마지막으로 본문/메타를 편집한 멤버 id — 서버 upsert 시 caller 로 스탬프. 미보유 시 createdByMemberId 폴백 */
  lastEditedByMemberId?: string;
  /** 마지막 편집자 표시 이름(스탬프 시점 스냅샷) */
  lastEditedByName?: string;
  /** 원격 메타만 로드된 상태면 false. 실제 doc fetch 후 true/undefined 로 전환한다. */
  contentLoaded?: boolean;
};

export type PageMap = Record<string, Page>;
