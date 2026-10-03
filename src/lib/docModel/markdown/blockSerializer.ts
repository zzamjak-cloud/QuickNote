// TipTap 블록 노드 → QFM 문자열.
import type { DocNode } from "../types";
import { serializeInline } from "./inlineSerializer";
import { ATTR_TAG_BY_TYPE, QN_BLOCK_TYPES, blockRefId, formatAttrTag } from "./nodeSpecs";
import { serializeTable } from "./tableMarkdown";
import { escapeLinesStart, formatTagAttrs } from "./textEscape";

export const EMPTY_BLOCK_TAG = "<empty-block/>";

function attrString(node: DocNode, name: string): string | undefined {
  const value = node.attrs?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function indentLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

function isEmptyInline(content: DocNode[] | undefined): boolean {
  return (content ?? []).every((n) => n.type === "text" && !(n.text ?? "").trim());
}

function qnBlock(node: DocNode): string {
  const ref = blockRefId(node);
  return `<qn-block${formatTagAttrs([["id", ref ?? undefined], ["type", node.type]])}/>`;
}

function paragraph(node: DocNode): string {
  if (isEmptyInline(node.content)) return EMPTY_BLOCK_TAG;
  return escapeLinesStart(serializeInline(node.content, { breakMode: "newline" }));
}

function heading(node: DocNode): string {
  const raw = Number(node.attrs?.level ?? 1);
  const level = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 6) : 1;
  return `${"#".repeat(level)} ${serializeInline(node.content, { breakMode: "br" })}`.trimEnd();
}

function codeBlock(node: DocNode): string {
  const code = (node.content ?? []).map((n) => n.text ?? "").join("");
  const longest = Math.max(0, ...(code.match(/^`{3,}/gm) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const lang = attrString(node, "language") ?? "";
  return `${fence}${lang}\n${code}${code ? "\n" : ""}${fence}`;
}

function image(node: DocNode): string {
  const spec = ATTR_TAG_BY_TYPE.get("image");
  const src = attrString(node, "src");
  const extras = Object.entries(spec?.attrs ?? {}).some(([name, def]) => {
    if (name === "src" || name === "alt" || name === "title") return false;
    const value = node.attrs?.[name];
    return value !== null && value !== undefined && value !== def.default;
  });
  const title = attrString(node, "title");
  if (!src || extras || !spec || title?.includes('"') || /[<>\n]/.test(src)) return spec ? formatAttrTag(spec, node) : "";
  const alt = (attrString(node, "alt") ?? "").replace(/([\\[\]])/g, "\\$1");
  const dest = /[\s()<>]/.test(src) ? `<${src}>` : src;
  return `![${alt}](${dest}${title ? ` "${title}"` : ""})`;
}

function horizontalRule(node: DocNode): string {
  const spec = ATTR_TAG_BY_TYPE.get("horizontalRule");
  const tag = spec ? formatAttrTag(spec, node) : "<hr/>";
  return tag === "<hr/>" ? "---" : tag;
}

function listItemMarker(list: DocNode, index: number, item: DocNode): string {
  if (list.type === "orderedList") {
    const start = Number(list.attrs?.start ?? 1);
    return `${(Number.isFinite(start) ? start : 1) + index}. `;
  }
  if (list.type === "taskList") return item.attrs?.checked === true ? "- [x] " : "- [ ] ";
  return "- ";
}

/** 목록 항목 자식 직렬화 — 다음 자식이 목록이면 붙이고, 아니면 빈 줄로 구분 */
function itemChildren(children: DocNode[]): string {
  return children.reduce((acc, child, i) => {
    const text = serializeBlock(child);
    if (i === 0) return text;
    return acc + (/List$/.test(child.type) ? "\n" : "\n\n") + text;
  }, "");
}

function list(node: DocNode): string {
  return (node.content ?? [])
    .map((item, index) => {
      const marker = listItemMarker(node, index, item);
      const children = item.content ?? [];
      const first = children[0];
      const firstEmpty = first?.type === "paragraph" && isEmptyInline(first.content);
      let body: string;
      if (children.length === 0 || (firstEmpty && children.length === 1)) body = "";
      else body = itemChildren(children);
      const width = node.type === "taskList" ? 2 : marker.length;
      const [head = "", ...rest] = body.split("\n");
      const tail = rest.length > 0 ? `\n${indentLines(rest.join("\n"), " ".repeat(width))}` : "";
      return `${marker}${head}`.trimEnd() + tail;
    })
    .join("\n");
}

function blockquote(node: DocNode): string {
  const inner = serializeBlocks(node.content);
  return inner
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function callout(node: DocNode): string {
  const preset = attrString(node, "preset");
  const attrs = formatTagAttrs([
    ["preset", preset === "idea" ? undefined : preset],
    ["icon", attrString(node, "emoji")],
  ]);
  return `<callout${attrs}>\n${serializeBlocks(node.content)}\n</callout>`;
}

function toggle(node: DocNode): string {
  const [header, content] = [
    (node.content ?? []).find((c) => c.type === "toggleHeader"),
    (node.content ?? []).find((c) => c.type === "toggleContent"),
  ];
  const open = node.attrs?.open === false ? "" : " open";
  const level = header ? attrString(header, "titleLevel") : undefined;
  const title = serializeInline(header?.content, { breakMode: "br" });
  const summary = `<summary${formatTagAttrs([["level", level]])}>${title}</summary>`;
  return `<details${open}>${summary}\n\n${serializeBlocks(content?.content)}\n\n</details>`;
}

function columns(node: DocNode): string {
  const preset = attrString(node, "preset");
  const cols = (node.content ?? []).map((col) => {
    const width = col.attrs?.width;
    const w = typeof width === "number" && width > 0 ? String(width) : undefined;
    return `<column${formatTagAttrs([["width", w]])}>\n${serializeBlocks(col.content)}\n</column>`;
  });
  const attrs = formatTagAttrs([["preset", preset === "empty" ? undefined : preset]]);
  return `<columns${attrs}>\n${cols.join("\n")}\n</columns>`;
}

function database(node: DocNode): string {
  const view = attrString(node, "view");
  const attrs = formatTagAttrs([
    ["id", attrString(node, "databaseId") ?? ""],
    ["layout", attrString(node, "layout") ?? "inline"],
    ["view", view === "table" ? undefined : view],
    ["readOnlyTitle", node.attrs?.readOnlyTitle === true ? "true" : undefined],
  ]);
  return `<database${attrs}/>`;
}

export function serializeBlock(node: DocNode): string {
  switch (node.type) {
    case "paragraph":
      return paragraph(node);
    case "heading":
      return heading(node);
    case "codeBlock":
      return codeBlock(node);
    case "blockquote":
      return blockquote(node);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return list(node);
    case "horizontalRule":
      return horizontalRule(node);
    case "image":
      return image(node);
    case "table":
      return serializeTable(node) ?? qnBlock(node);
    case "callout":
      return callout(node);
    case "toggle":
      return toggle(node);
    case "columnLayout":
      return columns(node);
    case "databaseBlock":
      return database(node);
    case "text":
      return escapeLinesStart(serializeInline([node], { breakMode: "newline" }));
    // 컨테이너 내부 노드가 단독으로 오면 자식만 직렬화(방어)
    case "listItem":
    case "taskItem":
    case "column":
    case "toggleContent":
    case "tabPanel":
      return serializeBlocks(node.content);
    case "toggleHeader":
      return escapeLinesStart(serializeInline(node.content, { breakMode: "newline" }));
    default: {
      if (QN_BLOCK_TYPES.has(node.type)) return qnBlock(node);
      const spec = ATTR_TAG_BY_TYPE.get(node.type);
      if (spec && !spec.inline) return formatAttrTag(spec, node);
      if (spec?.inline) return serializeInline([node], { breakMode: "newline" });
      return qnBlock(node);
    }
  }
}

export function serializeBlocks(nodes: DocNode[] | undefined): string {
  return (nodes ?? [])
    .map(serializeBlock)
    .filter((s) => s !== "")
    .join("\n\n");
}
