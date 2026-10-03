// DB 컬럼 정의·셀 값 → 사람이 읽는 `name: value` 텍스트.
// 옵션 id 는 라벨로, 멤버 id 는 이름으로, 페이지 링크는 QFM 멘션 태그로 바꾼다.
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { batchGetByKey } from "./ddb";

export type ColumnLite = {
  id: string;
  name: string;
  type: string;
  options: { id: string; label: string }[];
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseColumns(raw: unknown): ColumnLite[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => {
      const config = (c.config ?? {}) as Record<string, unknown>;
      const options = Array.isArray(config.options) ? (config.options as Record<string, unknown>[]) : [];
      return {
        id: String(c.id ?? ""),
        name: String(c.name ?? ""),
        type: String(c.type ?? "text"),
        options: options
          .filter((o) => o && !o.divider && typeof o.id === "string")
          .map((o) => ({ id: String(o.id), label: String(o.label ?? o.id) })),
      };
    })
    .filter((c) => c.id !== "");
}

export function parseCells(raw: unknown): Record<string, unknown> {
  const cells = parseJson(raw);
  return cells && typeof cells === "object" && !Array.isArray(cells) ? (cells as Record<string, unknown>) : {};
}

function idList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return typeof value === "string" && value.trim() ? [value] : [];
}

/** person 컬럼 값에서 멤버 id 를 모은다(이름 일괄 조회용). */
export function collectPersonIds(columns: ColumnLite[], cellsList: Record<string, unknown>[]): string[] {
  const personCols = columns.filter((c) => c.type === "person");
  return Array.from(new Set(cellsList.flatMap((cells) => personCols.flatMap((c) => idList(cells[c.id])))));
}

export async function loadMemberNames(
  doc: DynamoDBDocumentClient,
  membersTable: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const items = await batchGetByKey({
    doc,
    tableName: membersTable,
    keyName: "memberId",
    ids,
    projection: "memberId, #n",
    expressionNames: { "#n": "name" },
  });
  return new Map(items.map((m) => [String(m.memberId), String(m.name ?? m.memberId)]));
}

function genericText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(genericText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.start === "string") return o.end ? `${o.start} → ${String(o.end)}` : o.start;
    return [o.name, o.label, o.title, o.text].filter((v) => typeof v === "string" && v).join(" ");
  }
  return "";
}

export function renderCellValue(col: ColumnLite, value: unknown, memberNames: Map<string, string>): string {
  switch (col.type) {
    case "select":
    case "status":
    case "multiSelect": {
      const labels = new Map(col.options.map((o) => [o.id, o.label]));
      return idList(value).map((id) => labels.get(id) ?? id).join(", ");
    }
    case "person":
      return idList(value).map((id) => memberNames.get(id) ?? id).join(", ");
    case "pageLink":
      return idList(value).map((id) => `<mention-page id="${id}"/>`).join(", ");
    case "checkbox":
      return value === true ? "true" : value === false ? "false" : "";
    default:
      return genericText(value);
  }
}

/** 행 속성 목록 — title 컬럼은 페이지 제목과 같으므로 제외. 빈 값은 생략. */
export function renderProperties(
  columns: ColumnLite[],
  cells: Record<string, unknown>,
  memberNames: Map<string, string>,
): { name: string; value: string }[] {
  return columns
    .filter((c) => c.type !== "title")
    .map((c) => ({ name: c.name || c.id, value: renderCellValue(c, cells[c.id], memberNames) }))
    .filter((p) => p.value !== "");
}
