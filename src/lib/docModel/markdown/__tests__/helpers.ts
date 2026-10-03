// 테스트 공용: 문서 정규화(id·기본값 attr 제거, 마크 정렬, 인접 텍스트 병합) 및 노드 빌더.
import type { DocMark, DocNode } from "../../types";

// 스키마 기본값(editorSchemaSpec 기준) — 비교 시 기본값과 같은 attr 은 제거한다
const DEFAULTS: Record<string, Record<string, unknown>> = {
  "*": { textAlign: null, backgroundColor: null, blockTextColor: null, indent: 0 },
  heading: { level: 1 },
  orderedList: { start: 1, type: null },
  taskItem: { checked: false },
  codeBlock: { language: null },
  callout: { preset: "idea", emoji: null },
  columnLayout: { preset: "empty" },
  column: { width: null },
  toggle: { open: true },
  toggleHeader: { titleLevel: null },
  tableHeader: { colspan: 1, rowspan: 1, colwidth: null, align: null },
  tableCell: { colspan: 1, rowspan: 1, colwidth: null, align: null },
  databaseBlock: { layout: "inline", view: "table", readOnlyTitle: false },
  mention: { mentionSuggestionChar: "@", subtitle: null },
  link: { target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null },
  textStyle: { color: null },
  highlight: { color: null },
};

// id 가 의미 데이터인 노드(멘션·페이지 링크)
const SEMANTIC_ID = new Set(["mention", "pageLink"]);

function cleanAttrs(type: string, attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const defaults = { ...DEFAULTS["*"], ...(DEFAULTS[type] ?? {}) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "id" && !SEMANTIC_ID.has(type)) continue;
    if (v === null || v === undefined) continue;
    if (k in defaults && defaults[k] === v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanMarks(marks: DocMark[] | undefined): DocMark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  return marks
    .map((m) => {
      const attrs = cleanAttrs(m.type, m.attrs);
      return attrs ? { type: m.type, attrs } : { type: m.type };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
}

export function normalize(node: DocNode): DocNode {
  const out: DocNode = { type: node.type };
  const attrs = cleanAttrs(node.type, node.attrs);
  if (attrs) out.attrs = attrs;
  const marks = cleanMarks(node.marks);
  if (marks) out.marks = marks;
  if (node.text !== undefined) out.text = node.text;
  const content = (node.content ?? []).map(normalize).reduce<DocNode[]>((acc, child) => {
    const last = acc[acc.length - 1];
    if (
      last?.type === "text" &&
      child.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])
    ) {
      return [...acc.slice(0, -1), { ...last, text: (last.text ?? "") + (child.text ?? "") }];
    }
    return [...acc, child];
  }, []);
  if (content.length > 0) out.content = content;
  return out;
}

export const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
export const t = (text: string, ...marks: Array<string | DocMark>): DocNode =>
  marks.length > 0
    ? { type: "text", text, marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) }
    : { type: "text", text };
export const p = (...content: DocNode[]): DocNode =>
  content.length > 0 ? { type: "paragraph", attrs: { id: "blk" }, content } : { type: "paragraph" };
export const h = (level: number, ...content: DocNode[]): DocNode => ({
  type: "heading",
  attrs: { level, id: "h1x" },
  content,
});
export const li = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
export const link = (href: string): DocMark => ({ type: "link", attrs: { href } });
