// AI tool 실행 — databaseStore/pageStore 로컬 조회(서버 데이터 접근 없음).

import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { pageDocToMarkdown } from "../export/pageToMarkdown";
import { formatPlainDisplay } from "../../components/database/databaseCellDisplayUtils";
import {
  isInternalHiddenColumnId,
  type CellValue,
  type ColumnDef,
} from "../../types/database";
import { AI_DB_CELL_MAX_CHARS, AI_ROW_BODY_MAX_CHARS } from "./contextBuilder";

export type AiToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AiWireMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant_tools"; toolCalls: AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** tool 왕복 상한(계획 §6). */
export const AI_TOOL_ROUND_LIMIT = 5;

const LIST_LIMIT_DEFAULT = 30;
const LIST_LIMIT_MAX = 50;
const TOOL_RESULT_MAX = 20_000;

function clampText(s: string, max = TOOL_RESULT_MAX): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(생략)`;
}

function cellText(raw: string): string {
  const flat = raw.replace(/\r?\n/g, " ").trim();
  return flat.length > AI_DB_CELL_MAX_CHARS
    ? `${flat.slice(0, AI_DB_CELL_MAX_CHARS)}…`
    : flat;
}

function listRows(args: Record<string, unknown>): string {
  const databaseId = String(args.databaseId ?? "").trim();
  if (!databaseId) return "오류: databaseId 필요";
  const filter = String(args.filter ?? "").trim().toLowerCase();
  const limit = Math.min(
    LIST_LIMIT_MAX,
    Math.max(1, Number(args.limit) || LIST_LIMIT_DEFAULT),
  );

  const bundle = useDatabaseStore.getState().databases[databaseId];
  if (!bundle) return `오류: 데이터베이스를 찾을 수 없음 (${databaseId})`;
  const pages = usePageStore.getState().pages;
  const columns = (bundle.columns as ColumnDef[]).filter(
    (c) => !isInternalHiddenColumnId(c.id),
  );
  const titleCol = columns.find((c) => c.type === "title") ?? null;

  type Row = { rowId: string; title: string; cells: Record<string, string> };
  const rows: Row[] = [];
  for (const rowPageId of bundle.rowPageOrder ?? []) {
    const page = pages[rowPageId];
    if (!page) continue;
    const cells: Record<string, string> = {};
    for (const col of columns) {
      if (col.type === "title") {
        cells[col.name || "title"] = cellText(page.title ?? "");
        continue;
      }
      const raw = (page.dbCells?.[col.id] ?? null) as CellValue;
      cells[col.name || col.type] = cellText(formatPlainDisplay(raw, col) ?? "");
    }
    const title = titleCol
      ? cells[titleCol.name || "title"] || page.title || ""
      : page.title || "";
    if (filter) {
      const hay = `${title} ${Object.values(cells).join(" ")}`.toLowerCase();
      if (!hay.includes(filter)) continue;
    }
    rows.push({ rowId: rowPageId, title, cells });
  }

  const shown = rows.slice(0, limit);
  const lines = [
    `databaseId=${databaseId}`,
    `총 ${rows.length}행 중 ${shown.length}행`,
    ...shown.map((r) => {
      const cellSummary = Object.entries(r.cells)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      return `- rowId=${r.rowId} | ${r.title || "(제목 없음)"} | ${cellSummary}`;
    }),
  ];
  if (rows.length > shown.length) {
    lines.push(`…외 ${rows.length - shown.length}행 (limit=${limit})`);
  }
  return clampText(lines.join("\n"));
}

function getRow(args: Record<string, unknown>): string {
  const rowId = String(args.rowId ?? "").trim();
  if (!rowId) return "오류: rowId 필요";
  const page = usePageStore.getState().pages[rowId];
  if (!page) return `오류: 행을 찾을 수 없음 (${rowId})`;
  const databaseId = page.databaseId;
  const bundle = databaseId
    ? useDatabaseStore.getState().databases[databaseId]
    : null;
  const columns = ((bundle?.columns as ColumnDef[]) ?? []).filter(
    (c) => !isInternalHiddenColumnId(c.id),
  );

  const lines = [
    `rowId=${rowId}`,
    `title=${page.title || "(제목 없음)"}`,
    databaseId ? `databaseId=${databaseId}` : null,
  ].filter(Boolean) as string[];

  for (const col of columns) {
    if (col.type === "title") continue;
    const raw = (page.dbCells?.[col.id] ?? null) as CellValue;
    lines.push(`${col.name || col.type}: ${cellText(formatPlainDisplay(raw, col) ?? "")}`);
  }

  if (page.doc) {
    let body = pageDocToMarkdown(page.doc).trim();
    if (body) {
      if (body.length > AI_ROW_BODY_MAX_CHARS) {
        body = `${body.slice(0, AI_ROW_BODY_MAX_CHARS)}…`;
      }
      lines.push("", "## 본문 앞부분", body);
    }
  }
  return clampText(lines.join("\n"));
}

function getPageContent(args: Record<string, unknown>): string {
  const pageId = String(args.pageId ?? "").trim();
  if (!pageId) return "오류: pageId 필요";
  const page = usePageStore.getState().pages[pageId];
  if (!page) return `오류: 페이지를 찾을 수 없음 (${pageId})`;
  const title = page.title || "(제목 없음)";
  let body = page.doc ? pageDocToMarkdown(page.doc).trim() : "";
  if (!body) body = "(본문 없음)";
  const max = 12_000;
  if (body.length > max) body = `${body.slice(0, max)}\n…(생략)`;
  return clampText(`# ${title}\n\npageId=${pageId}\n\n${body}`);
}

export function toolStatusLabel(name: string): string {
  switch (name) {
    case "list_rows":
      return "행 목록 조회 중…";
    case "get_row":
      return "행 조회 중…";
    case "get_page_content":
      return "페이지 본문 조회 중…";
    default:
      return "추가 데이터 조회 중…";
  }
}

/** 로컬 스토어에서 tool 호출을 해석해 문자열 결과를 반환. */
export function executeAiTool(call: AiToolCall): string {
  try {
    switch (call.name) {
      case "list_rows":
        return listRows(call.args);
      case "get_row":
        return getRow(call.args);
      case "get_page_content":
        return getPageContent(call.args);
      default:
        return `오류: 알 수 없는 도구 (${call.name})`;
    }
  } catch (e) {
    console.error("AI tool 실행 실패", call.name, e);
    return `오류: 도구 실행 실패 (${call.name})`;
  }
}
