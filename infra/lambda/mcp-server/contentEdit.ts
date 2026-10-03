// update_page 본문 모드 → collabWriter 편집 계획. QFM 파싱 규약(Plan §10.1):
// resolveBlockRef 는 "현재 본문" 참조로만 한정하고, 삽입 모드는 기존 qn-block 을 참조할 수 없다(복제 방지).
// 결과 문서에 같은 <database id> 가 두 번 이상이면 거부한다.
import { z } from "zod";
import { QfmError, collectBlockRefs, qfmToDoc } from "../../../src/lib/docModel/markdown";
import type { DocNode } from "../../../src/lib/docModel/types";
import type { DocJson } from "../_shared/collabContent";
import type { BodyEdit } from "./collabWriter";
import { ToolError } from "./context";
import { collectNodeText } from "./text";

export const CONTENT_MODES = ["replace", "append", "insert_after", "replace_range"] as const;

export const contentInput = z
  .object({
    mode: z.enum(CONTENT_MODES).describe(
      "replace: whole body. append: add blocks at the end. insert_after: add blocks after the top-level block whose text equals `anchor`. " +
        "replace_range: replace top-level blocks from the one starting with `rangeStart` through the first one at/after it starting with `rangeEnd`.",
    ),
    markdown: z.string().describe("QFM content (see fetch tool description for syntax). Max 512KB."),
    anchor: z.string().trim().min(1).max(2000).optional().describe("insert_after: exact text of a top-level block"),
    rangeStart: z.string().trim().min(1).max(2000).optional().describe("replace_range: text prefix of the first block to replace"),
    rangeEnd: z.string().trim().min(1).max(2000).optional().describe("replace_range: text prefix of the last block to replace"),
    occurrence: z.number().int().min(1).max(1000).optional().describe("1-based match to use when anchor/rangeStart matches several blocks"),
  })
  .strict();
export type ContentInput = z.infer<typeof contentInput>;

export type ContentPlan = { edit: BodyEdit; checkpoint: boolean; databaseIds: string[] };

const NO_REFS = (): DocNode | null => null;
const MARKDOWN_PREFIX = /^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/;

function parse(markdown: string, refs: Map<string, DocNode> | null): DocNode {
  try {
    return qfmToDoc(markdown, { resolveBlockRef: refs ? (id) => refs.get(id) ?? null : NO_REFS });
  } catch (err) {
    if (err instanceof QfmError) {
      const hint = err.code === "UNRESOLVED_BLOCK_REF" && !refs
        ? " (existing <qn-block> lines can only be kept with mode replace/replace_range)"
        : "";
      throw new ToolError(`${err.code}: ${err.message}${hint}`);
    }
    throw err;
  }
}

export function databaseIdsOf(node: DocNode, out: string[] = []): string[] {
  if (node.type === "databaseBlock" && typeof node.attrs?.databaseId === "string" && node.attrs.databaseId) {
    out.push(node.attrs.databaseId);
  }
  for (const child of node.content ?? []) databaseIdsOf(child, out);
  return out;
}

/** 결과 문서의 database 블록 id 목록. 중복이면 거부한다. */
export function assertUniqueDatabases(doc: DocNode): string[] {
  const ids = databaseIdsOf(doc);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new ToolError(`Database ${dup} would appear more than once on the page; a database can be embedded only once`);
  return ids;
}

function blockText(block: DocNode): string {
  return collectNodeText(block).trim().normalize("NFC");
}

function matchIndexes(blocks: DocNode[], needle: string, test: (text: string, n: string) => boolean): number[] {
  const n = needle.normalize("NFC");
  const stripped = n.replace(MARKDOWN_PREFIX, "");
  const hits = blocks.map((b, i) => (test(blockText(b), n) ? i : -1)).filter((i) => i >= 0);
  if (hits.length > 0 || stripped === n) return hits;
  return blocks.map((b, i) => (test(blockText(b), stripped) ? i : -1)).filter((i) => i >= 0);
}

function pickOne(hits: number[], label: string, needle: string, occurrence?: number): number {
  if (hits.length === 0) throw new ToolError(`${label} "${needle}" does not match any top-level block (use fetch to see the current text)`);
  if (occurrence !== undefined) {
    const hit = hits[occurrence - 1];
    if (hit === undefined) throw new ToolError(`${label} matches ${hits.length} block(s); occurrence ${occurrence} is out of range`);
    return hit;
  }
  if (hits.length > 1) throw new ToolError(`${label} "${needle}" matches ${hits.length} blocks; pass occurrence (1-based) to choose one`);
  return hits[0];
}

function newBlocks(markdown: string): DocNode[] {
  if (markdown.trim() === "") throw new ToolError("markdown must not be empty for this mode");
  return parse(markdown, null).content ?? [];
}

function planRange(base: DocNode, input: ContentInput): ContentPlan {
  if (!input.rangeStart || !input.rangeEnd) throw new ToolError("replace_range requires rangeStart and rangeEnd");
  const blocks = base.content ?? [];
  const prefix = (text: string, n: string) => text.startsWith(n);
  const start = pickOne(matchIndexes(blocks, input.rangeStart, prefix), "rangeStart", input.rangeStart, input.occurrence);
  const end = matchIndexes(blocks, input.rangeEnd, prefix).find((i) => i >= start);
  if (end === undefined) throw new ToolError(`rangeEnd "${input.rangeEnd}" does not match any top-level block at or after rangeStart`);
  const replaced = blocks.slice(start, end + 1);
  const refs = collectBlockRefs({ type: "doc", content: replaced });
  const parsed = input.markdown.trim() === "" ? [] : (parse(input.markdown, refs).content ?? []);
  const doc: DocNode = { ...base, content: [...blocks.slice(0, start), ...parsed, ...blocks.slice(end + 1)] };
  return { edit: { kind: "replace", doc: doc as DocJson }, checkpoint: true, databaseIds: assertUniqueDatabases(doc) };
}

/** 현재 본문(base) 기준으로 모드별 편집 계획을 만든다. */
export function planContentEdit(baseDoc: DocJson, input: ContentInput): ContentPlan {
  const base = baseDoc as DocNode;
  if (input.mode === "replace") {
    const doc = parse(input.markdown, collectBlockRefs(base));
    return { edit: { kind: "replace", doc: doc as DocJson }, checkpoint: true, databaseIds: assertUniqueDatabases(doc) };
  }
  if (input.mode === "replace_range") return planRange(base, input);
  const blocks = newBlocks(input.markdown);
  const databaseIds = assertUniqueDatabases({ ...base, content: [...(base.content ?? []), ...blocks] });
  if (input.mode === "append") {
    return { edit: { kind: "insert", blocks: blocks as DocJson[], at: "end" }, checkpoint: false, databaseIds };
  }
  if (!input.anchor) throw new ToolError("insert_after requires anchor");
  const exact = (text: string, n: string) => text === n;
  const index = pickOne(matchIndexes(base.content ?? [], input.anchor, exact), "anchor", input.anchor, input.occurrence);
  return { edit: { kind: "insert", blocks: blocks as DocJson[], at: { index: index + 1 } }, checkpoint: false, databaseIds };
}

/** 새 페이지 본문(create_pages) — 참조 없이 파싱. 빈 입력은 doc=null(빈 페이지). */
export function parseNewPageContent(markdown: string | undefined): { doc: DocNode | null; databaseIds: string[] } {
  if (markdown === undefined || markdown.trim() === "") return { doc: null, databaseIds: [] };
  const doc = parse(markdown, null);
  return { doc, databaseIds: assertUniqueDatabases(doc) };
}
