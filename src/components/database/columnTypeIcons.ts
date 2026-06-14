import type { ColumnDef, ColumnType } from "../../types/database";
import { encodeLucidePageIcon } from "../../lib/pageIcon";

/** 컬럼 타입별 기본 lucide 아이콘 이름 */
const COLUMN_TYPE_LUCIDE: Record<ColumnType, string> = {
  title: "Type",
  text: "AlignLeft",
  json: "Braces",
  number: "Hash",
  select: "CircleDot",
  multiSelect: "Tags",
  status: "CircleDashed",
  date: "Calendar",
  person: "User",
  file: "Paperclip",
  checkbox: "SquareCheck",
  url: "Link",
  phone: "Phone",
  email: "Mail",
  dbLink: "Database",
  pageLink: "Link2",
  progress: "GaugeCircle",
  itemFetch: "PackageSearch",
};

/** 컬럼 타입별 한국어 라벨 — 메뉴/패널 단일 출처. (과거 3개 파일에 중복·드리프트되던 것 통합) */
export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  title: "제목",
  text: "텍스트",
  json: "JSON",
  number: "숫자",
  select: "선택",
  multiSelect: "다중 선택",
  status: "상태",
  date: "날짜",
  person: "사람",
  file: "파일",
  checkbox: "체크박스",
  url: "URL",
  phone: "연락처",
  email: "이메일",
  dbLink: "DB 연결",
  pageLink: "페이지 연결",
  progress: "진행률",
  itemFetch: "페이지 연결 가져오기",
};

/** 타입 라벨(미정의 폴백은 타입 식별자). */
export function columnTypeLabel(type: ColumnType): string {
  return COLUMN_TYPE_LABELS[type] ?? type;
}

/** 타입별 기본 아이콘(pageIcon 인코딩 문자열) */
export function defaultColumnIcon(type: ColumnType): string {
  return encodeLucidePageIcon(COLUMN_TYPE_LUCIDE[type]);
}

/** 사용자 지정 아이콘이 있으면 그대로, 없으면 타입 기본 아이콘 */
export function resolveColumnIcon(col: ColumnDef): string {
  return col.icon ?? defaultColumnIcon(col.type);
}
