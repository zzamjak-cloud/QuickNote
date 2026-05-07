import type { JSONContent } from "@tiptap/react";
import type { CellValue } from "./database";

export type Page = {
  id: string;
  title: string;
  icon: string | null;
  doc: JSONContent;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** 이 페이지가 DB 행이면 소속 데이터베이스 id */
  databaseId?: string;
  /** title 컬럼을 제외한 셀 값 */
  dbCells?: Record<string, CellValue>;
  /** 커버 이미지 data URL 또는 원격 URL */
  coverImage?: string | null;
};

export type PageMap = Record<string, Page>;
