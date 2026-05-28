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

/** 타입별 기본 아이콘(pageIcon 인코딩 문자열) */
export function defaultColumnIcon(type: ColumnType): string {
  return encodeLucidePageIcon(COLUMN_TYPE_LUCIDE[type]);
}

/** 사용자 지정 아이콘이 있으면 그대로, 없으면 타입 기본 아이콘 */
export function resolveColumnIcon(col: ColumnDef): string {
  return col.icon ?? defaultColumnIcon(col.type);
}
