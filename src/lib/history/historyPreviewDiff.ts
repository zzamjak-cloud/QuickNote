import type { JSONContent } from "@tiptap/react";
import type { PageSnapshot } from "../../types/history";
import type { DatabaseHistorySnapshot } from "./databaseHistoryPatch";

export type HistoryPreviewChange = {
  id: string;
  label: string;
  before: string;
  after: string;
  kind: "added" | "removed" | "changed";
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

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
): HistoryPreviewChange[] {
  if (!after) return [];
  const out: HistoryPreviewChange[] = [];
  pushValueChange(out, "title", "페이지 제목", before?.title, after.title);
  pushValueChange(out, "icon", "아이콘", before?.icon, after.icon);
  pushValueChange(out, "cover", "커버", before?.coverImage, after.coverImage);
  pushValueChange(out, "parent", "상위 페이지", before?.parentId, after.parentId);
  pushValueChange(out, "order", "정렬 순서", before?.order, after.order);
  pushValueChange(out, "database", "연결 DB", before?.databaseId, after.databaseId);

  const beforeCells = pageCells(before);
  const afterCells = pageCells(after);
  for (const key of new Set([...Object.keys(beforeCells), ...Object.keys(afterCells)])) {
    pushValueChange(out, `cell:${key}`, `속성 ${key}`, beforeCells[key], afterCells[key]);
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
  pushValueChange(out, "workspace", "워크스페이스", before?.workspaceId, after.workspaceId);
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
    pushValueChange(out, `column-config:${id}`, `컬럼 설정 ${label}`, beforeColumn.config, afterColumn.config);
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
