// GFM 표 ↔ TipTap table 노드 변환.
import type { DocNode } from "../types";
import { serializeInline } from "./inlineSerializer";
import { blockRefId } from "./nodeSpecs";

type Align = "left" | "center" | "right" | null;

function cellAlign(cell: DocNode | undefined): Align {
  const a = cell?.attrs?.align;
  return a === "left" || a === "center" || a === "right" ? a : null;
}

function isSimpleTable(rows: DocNode[]): boolean {
  const width = rows[0]?.content?.length ?? 0;
  return rows.every(
    (row) =>
      (row.content?.length ?? 0) === width &&
      (row.content ?? []).every(
        (cell) =>
          Number(cell.attrs?.colspan ?? 1) <= 1 &&
          Number(cell.attrs?.rowspan ?? 1) <= 1 &&
          (cell.content ?? []).every((b) => b.type === "paragraph"),
      ),
  );
}

function cellText(cell: DocNode): string {
  return (cell.content ?? [])
    .map((p) => serializeInline(p.content, { breakMode: "br", inTable: true }))
    .join("<br>")
    .trim();
}

function delimiter(align: Align): string {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  if (align === "left") return ":---";
  return "---";
}

/**
 * table → GFM 표. 병합 셀·비문단 블록 등 GFM 으로 표현 불가하고 참조 id 가 있으면 null
 * (호출부가 qn-block 으로 대체). id 가 없으면 최대한 근사해 직렬화한다.
 */
export function serializeTable(node: DocNode): string | null {
  const rows = (node.content ?? []).filter((r) => (r.content?.length ?? 0) > 0);
  if (rows.length === 0) return "";
  if (!isSimpleTable(rows) && blockRefId(node)) return null;
  const width = Math.max(...rows.map((r) => r.content?.length ?? 0));
  const line = (row: DocNode): string => {
    const cells = Array.from({ length: width }, (_, i) => {
      const cell = row.content?.[i];
      return cell ? cellText(cell) : "";
    });
    return `| ${cells.join(" | ")} |`;
  };
  const header = rows[0] as DocNode;
  const aligns = Array.from({ length: width }, (_, i) => delimiter(cellAlign(header.content?.[i])));
  return [line(header), `| ${aligns.join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

export function isTableRowLine(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.length > 1;
}

export function isTableDelimiterLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("-")) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
}

/** 이스케이프된 `\|` 는 분리하지 않는다(셀 인라인 파서가 해제). */
export function splitTableRow(line: string): string[] {
  const s = line.trim();
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] ?? "";
    if (ch === "\\" && i + 1 < s.length) {
      cur += ch + (s[i + 1] ?? "");
      i += 1;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  if (s.startsWith("|")) cells.shift();
  if (s.endsWith("|") && !s.endsWith("\\|")) cells.pop();
  return cells.map((c) => c.trim());
}

function parseAlign(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function buildTable(
  headerLine: string,
  delimiterLine: string,
  bodyLines: string[],
  parseInline: (text: string) => DocNode[],
): DocNode {
  const header = splitTableRow(headerLine);
  const width = Math.max(1, header.length);
  const aligns = splitTableRow(delimiterLine).map(parseAlign);
  const cell = (text: string, col: number, isHeader: boolean): DocNode => {
    const align = aligns[col] ?? null;
    const inline = parseInline(text);
    return {
      type: isHeader ? "tableHeader" : "tableCell",
      ...(align ? { attrs: { align } } : {}),
      content: [{ type: "paragraph", ...(inline.length > 0 ? { content: inline } : {}) }],
    };
  };
  const row = (cells: string[], isHeader: boolean): DocNode => ({
    type: "tableRow",
    content: Array.from({ length: width }, (_, i) => cell(cells[i] ?? "", i, isHeader)),
  });
  return {
    type: "table",
    content: [row(header, true), ...bodyLines.map((l) => row(splitTableRow(l), false))],
  };
}
