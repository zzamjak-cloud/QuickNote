import type { JSONContent } from "@tiptap/react";
import type { PageSnapshot } from "../../types/history";
import type { DatabaseHistorySnapshot } from "./databaseHistoryPatch";
import { isRecord } from "../util/typeGuards";

export type HistoryPreviewChange = {
  id: string;
  label: string;
  before: string;
  after: string;
  kind: "added" | "removed" | "changed";
};

/** 변경 목록을 한 줄 요약으로 — 리스트에서 "무엇이 바뀌었나"를 직관적으로 보여주기 위함 */
export function summarizePreviewChanges(changes: HistoryPreviewChange[]): string {
  if (changes.length === 0) return "";
  const first = changes[0]!.label;
  return changes.length > 1 ? `${first} 외 ${changes.length - 1}건` : first;
}

export type PagePreviewContext = {
  getDatabaseTitle?: (id: string) => string | null | undefined;
  getPageTitle?: (id: string) => string | null | undefined;
  getColumnName?: (columnId: string) => string | null | undefined;
  getOptionLabel?: (columnId: string, optionId: string) => string | null | undefined;
};

function stringifyValue(value: unknown): string {
  if (value == null || value === "") return "비어 있음";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "비어 있음";
    return value.map(stringifyValue).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatColumnConfig(config: unknown): string {
  if (config == null || config === "") return "비어 있음";
  const parsed = parseJsonValue<Record<string, unknown>>(config, {});
  if (!isRecord(parsed)) return stringifyValue(config);
  const parts: string[] = [];
  if (Array.isArray(parsed.options)) {
    const labels = parsed.options
      .filter((o): o is Record<string, unknown> => isRecord(o) && !o.divider)
      .map((o) => (typeof o.label === "string" ? o.label : String(o.id)));
    if (labels.length > 0) parts.push(`옵션: ${labels.join(", ")}`);
  }
  if (typeof parsed.dateShowEnd === "boolean") {
    parts.push(`날짜 범위: ${parsed.dateShowEnd ? "표시" : "숨김"}`);
  }
  if (isRecord(parsed.sourceFromDb)) parts.push("다른 DB에서 가져옴");
  return parts.length > 0 ? parts.join(" / ") : stringifyValue(config);
}

function resolveCellValue(
  value: unknown,
  columnId: string,
  ctx: PagePreviewContext,
): string {
  if (value == null || value === "") return "비어 있음";
  const resolve = (id: unknown): string => {
    if (typeof id !== "string") return stringifyValue(id);
    const label = ctx.getOptionLabel?.(columnId, id);
    return label ?? id;
  };
  if (Array.isArray(value)) {
    if (value.length === 0) return "비어 있음";
    return value.map(resolve).join(", ");
  }
  return resolve(value);
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function pushValueChange(
  out: HistoryPreviewChange[],
  id: string,
  label: string,
  before: unknown,
  after: unknown,
): void {
  if (equalJson(before, after)) return;
  const beforeEmpty = before == null || before === "";
  const afterEmpty = after == null || after === "";
  out.push({
    id,
    label,
    before: stringifyValue(before),
    after: stringifyValue(after),
    kind: beforeEmpty ? "added" : afterEmpty ? "removed" : "changed",
  });
}

function textOfNode(node: JSONContent | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  const attrsText =
    typeof node.attrs?.label === "string"
      ? node.attrs.label
      : typeof node.attrs?.title === "string"
        ? node.attrs.title
        : "";
  const contentText = Array.isArray(node.content)
    ? node.content.map(textOfNode).join("")
    : "";
  if (node.type === "hardBreak") return "\n";
  return `${attrsText}${contentText}`;
}

function collectDocLines(doc: unknown): string[] {
  const parsedDoc = typeof doc === "string" ? parseJsonValue<unknown>(doc, null) : doc;
  if (!parsedDoc || typeof parsedDoc !== "object") return [];
  const root = parsedDoc as JSONContent;
  const out: string[] = [];
  const visit = (node: JSONContent, depth: number): void => {
    const blockLike =
      depth > 0 &&
      (node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "blockquote" ||
        node.type === "callout" ||
        node.type === "toggleHeader" ||
        node.type === "codeBlock" ||
        node.type === "databaseBlock" ||
        node.type === "image" ||
        node.type === "youtube" ||
        node.type === "fileBlock" ||
        node.type === "buttonBlock");
    if (blockLike) {
      const text = textOfNode(node).trim();
      const label =
        text ||
        (node.type === "databaseBlock"
          ? "데이터베이스 블록"
          : node.type === "image"
            ? "이미지 블록"
            : node.type === "youtube"
              ? "유튜브 블록"
              : node.type === "fileBlock"
                ? "파일 블록"
                : node.type === "buttonBlock"
                  ? "버튼 블록"
                  : "빈 블록");
      out.push(label.replace(/\s+/g, " "));
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function buildLineChanges(
  out: HistoryPreviewChange[],
  idPrefix: string,
  labelPrefix: string,
  beforeLines: string[],
  afterLines: string[],
): void {
  const max = Math.max(beforeLines.length, afterLines.length);
  let pushed = 0;
  for (let i = 0; i < max; i += 1) {
    if (beforeLines[i] === afterLines[i]) continue;
    out.push({
      id: `${idPrefix}:${i}`,
      label: `${labelPrefix} ${i + 1}`,
      before: beforeLines[i] ?? "없음",
      after: afterLines[i] ?? "없음",
      kind: beforeLines[i] == null ? "added" : afterLines[i] == null ? "removed" : "changed",
    });
    pushed += 1;
    if (pushed >= 24) break;
  }
}

function pageCells(snapshot: PageSnapshot | null): Record<string, unknown> {
  const parsed = parseJsonValue<unknown>(snapshot?.dbCells, {});
  return isRecord(parsed) ? parsed : {};
}

export function buildPagePreviewChanges(
  before: PageSnapshot | null,
  after: PageSnapshot | null,
  ctx: PagePreviewContext = {},
): HistoryPreviewChange[] {
  if (!after) return [];
  const out: HistoryPreviewChange[] = [];
  pushValueChange(out, "title", "페이지 제목", before?.title, after.title);
  pushValueChange(out, "icon", "아이콘", before?.icon, after.icon);
  pushValueChange(out, "cover", "커버", before?.coverImage, after.coverImage);

  const resolveParent = (id: string | null | undefined) =>
    id ? (ctx.getPageTitle?.(id) ?? id) : id;
  pushValueChange(out, "parent", "상위 페이지", resolveParent(before?.parentId), resolveParent(after.parentId));

  const resolveDb = (id: string | null | undefined) =>
    id ? (ctx.getDatabaseTitle?.(id) ?? id) : id;
  pushValueChange(out, "database", "연결 DB", resolveDb(before?.databaseId), resolveDb(after.databaseId));

  const beforeCells = pageCells(before);
  const afterCells = pageCells(after);
  for (const key of new Set([...Object.keys(beforeCells), ...Object.keys(afterCells)])) {
    const colLabel = ctx.getColumnName?.(key) ?? key;
    const beforeVal = resolveCellValue(beforeCells[key], key, ctx);
    const afterVal = resolveCellValue(afterCells[key], key, ctx);
    if (beforeVal === afterVal) continue;
    const beforeEmpty = beforeCells[key] == null || beforeCells[key] === "";
    const afterEmpty = afterCells[key] == null || afterCells[key] === "";
    out.push({
      id: `cell:${key}`,
      label: `속성: ${colLabel}`,
      before: beforeVal,
      after: afterVal,
      kind: beforeEmpty ? "added" : afterEmpty ? "removed" : "changed",
    });
  }

  buildLineChanges(
    out,
    "doc",
    "본문 블록",
    collectDocLines(before?.doc),
    collectDocLines(after.doc),
  );
  return out;
}

type PreviewColumn = {
  id: string;
  name?: string | null;
  type?: string | null;
  config?: unknown;
};

function databaseColumns(db: DatabaseHistorySnapshot | null): PreviewColumn[] {
  const parsed = parseJsonValue<unknown[]>(db?.columns, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((column): column is PreviewColumn => {
    return isRecord(column) && typeof column.id === "string";
  });
}

function databasePanelState(db: DatabaseHistorySnapshot | null): Record<string, unknown> | null {
  const parsed = parseJsonValue<unknown>(db?.panelState, null);
  return isRecord(parsed) ? parsed : null;
}

function columnLabel(columnId: string, db: DatabaseHistorySnapshot | null): string {
  return databaseColumns(db).find((column) => column.id === columnId)?.name ?? columnId;
}

export function buildDatabasePreviewChanges(
  before: DatabaseHistorySnapshot | null,
  after: DatabaseHistorySnapshot | null,
): HistoryPreviewChange[] {
  if (!after) return [];
  const out: HistoryPreviewChange[] = [];
  pushValueChange(out, "title", "DB 이름", before?.title, after.title);
  pushValueChange(out, "deleted", "삭제 상태", before?.deletedAt, after.deletedAt);

  const beforeColumns = new Map(databaseColumns(before).map((column) => [column.id, column]));
  const afterColumnList = databaseColumns(after);
  const afterColumns = new Map(afterColumnList.map((column) => [column.id, column]));
  for (const id of new Set([...beforeColumns.keys(), ...afterColumns.keys()])) {
    const beforeColumn = beforeColumns.get(id);
    const afterColumn = afterColumns.get(id);
    const label = afterColumn?.name ?? beforeColumn?.name ?? id;
    if (!beforeColumn || !afterColumn) {
      pushValueChange(out, `column:${id}`, `컬럼 ${label}`, beforeColumn?.name, afterColumn?.name);
      continue;
    }
    pushValueChange(out, `column-name:${id}`, `컬럼 이름 ${label}`, beforeColumn.name, afterColumn.name);
    pushValueChange(out, `column-type:${id}`, `컬럼 타입 ${label}`, beforeColumn.type, afterColumn.type);
    if (!equalJson(beforeColumn.config, afterColumn.config)) {
      out.push({
        id: `column-config:${id}`,
        label: `컬럼 설정 ${label}`,
        before: formatColumnConfig(beforeColumn.config),
        after: formatColumnConfig(afterColumn.config),
        kind: "changed",
      });
    }
  }

  const beforePanel = databasePanelState(before);
  const afterPanel = databasePanelState(after);
  pushValueChange(out, "panel-filter", "필터", beforePanel?.filterRules, afterPanel?.filterRules);
  pushValueChange(out, "panel-sort", "정렬", beforePanel?.sortRules, afterPanel?.sortRules);
  pushValueChange(out, "panel-views", "뷰 설정", beforePanel?.viewConfigs, afterPanel?.viewConfigs);
  pushValueChange(out, "panel-presets", "필터 프리셋", beforePanel?.filterPresets, afterPanel?.filterPresets);
  pushValueChange(
    out,
    "presets",
    "행 프리셋",
    parseJsonValue(before?.presets, null),
    parseJsonValue(after.presets, null),
  );

  const columnOrderBefore = databaseColumns(before).map((column) => column.id);
  const columnOrderAfter = afterColumnList.map((column) => column.id);
  buildLineChanges(
    out,
    "column-order",
    "컬럼 순서",
    columnOrderBefore.map((id) => columnLabel(id, before)),
    columnOrderAfter.map((id) => columnLabel(id, after)),
  );

  return out;
}
