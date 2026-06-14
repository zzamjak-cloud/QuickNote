import type { JSONContent } from "@tiptap/react";

/** GFM 표 셀: 파이프·줄바꿈 이스케이프 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** tableHeader/tableCell 내부 텍스트(인라인 마크다운 포함) */
function tableCellToMd(cell: JSONContent): string {
  const blocks = cell.content ?? [];
  const parts = blocks.map((block) => {
    if (block.type === "paragraph") {
      return (block.content ?? []).map(inlineToMd).join("");
    }
    return nodeToMd(block, 0).trim();
  });
  return escapeTableCell(parts.filter(Boolean).join(" "));
}

function tableRowToMdLine(row: JSONContent): string {
  const cells = (row.content ?? []).map(tableCellToMd);
  return `| ${cells.join(" | ")} |`;
}

function tableToMd(node: JSONContent): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";

  const headerRow = rows[0];
  if (!headerRow) return "";
  const colCount = headerRow.content?.length ?? 0;
  if (colCount === 0) return "";

  const headerLine = tableRowToMdLine(headerRow);
  const delimiter = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
  const bodyLines = rows.slice(1).map(tableRowToMdLine);

  return [headerLine, delimiter, ...bodyLines].join("\n") + "\n";
}

// 노드를 재귀적으로 마크다운으로 변환
function nodeToMd(node: JSONContent, depth = 0): string {
  if (!node) return "";

  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((n) => nodeToMd(n, depth)).join("\n");
    case "table":
      return tableToMd(node);
    case "tableRow":
    case "tableHeader":
    case "tableCell":
      // table 노드가 하위를 직접 직렬화한다
      return "";
    case "paragraph": {
      const text = (node.content ?? []).map(inlineToMd).join("");
      return text ? text + "\n" : "\n";
    }
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const text = (node.content ?? []).map(inlineToMd).join("");
      return "#".repeat(level) + " " + text + "\n";
    }
    case "bulletList":
      return (node.content ?? []).map((item) => nodeToMd(item, depth)).join("");
    case "orderedList":
      return (node.content ?? [])
        .map((item, i) => {
          const text = (item.content ?? [])
            .flatMap((n) => (n.content ?? []).map(inlineToMd))
            .join("");
          return `${i + 1}. ${text}\n`;
        })
        .join("");
    case "listItem": {
      const indent = "  ".repeat(depth);
      const children = node.content ?? [];
      const firstPara = children[0];
      const firstText = firstPara
        ? (firstPara.content ?? []).map(inlineToMd).join("")
        : "";
      const rest = children
        .slice(1)
        .map((n) => nodeToMd(n, depth + 1))
        .join("");
      return `${indent}- ${firstText}\n${rest}`;
    }
    case "blockquote": {
      const inner = (node.content ?? [])
        .map((n) => nodeToMd(n, depth))
        .join("");
      return (
        inner
          .split("\n")
          .map((l) => (l ? "> " + l : ">"))
          .join("\n") + "\n"
      );
    }
    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return "```" + lang + "\n" + code + "\n```\n";
    }
    case "horizontalRule":
      return "---\n";
    case "image":
      return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})\n`;
    default:
      return (node.content ?? []).map((n) => nodeToMd(n, depth)).join("");
  }
}

// 인라인 노드를 마크다운으로 변환
function inlineToMd(node: JSONContent): string {
  const text = node.text ?? "";
  if (!text) return "";
  const marks = node.marks ?? [];
  let result = text;
  for (const mark of marks) {
    if (mark.type === "bold") result = `**${result}**`;
    else if (mark.type === "italic") result = `_${result}_`;
    else if (mark.type === "code") result = "`" + result + "`";
    else if (mark.type === "strike") result = `~~${result}~~`;
    else if (mark.type === "link")
      result = `[${result}](${mark.attrs?.href ?? ""})`;
  }
  return result;
}

// TipTap JSONContent 문서를 마크다운 문자열로 변환
export function pageDocToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  return nodeToMd(doc);
}
