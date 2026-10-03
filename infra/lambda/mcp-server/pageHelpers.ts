// 쓰기 툴 공용 — 형제 순서·제목 중복 회피·신규 본문 정규화·database 블록 검증.
// 순서·제목 규칙은 클라 pageStore(nextOrderForParent·allocateUniquePageTitle)와 같다.
import { Node as PMNode } from "prosemirror-model";
import {
  blockIdTypesOf,
  normalizeLegacyJsonNode,
  schemaFromSpec,
  type DocJson,
} from "../_shared/collabContent";
import { fillMissingBlockIds, stripBlockIds } from "../_shared/docJson";
import type { DocNode } from "../../../src/lib/docModel/types";
import { docByteLength, MAX_PAGE_DOC_BYTES } from "./collabWriter";
import { ToolError, type McpContext } from "./context";
import { batchGetByKey } from "./ddb";
import { scanWorkspaceMetas, MAX_SCANNED_METAS, type PageMeta } from "./pageScan";

/** 클라 EMPTY_DOC 와 같은 빈 본문(placeholder). */
export const EMPTY_PAGE_DOC: DocJson = { type: "doc", content: [{ type: "paragraph" }] };
const UNTITLED = "제목 없음";

export async function workspaceMetas(ctx: McpContext, workspaceId: string): Promise<PageMeta[]> {
  const scan = await scanWorkspaceMetas({ doc: ctx.doc, pagesTable: ctx.tables.Pages, workspaceId, budget: MAX_SCANNED_METAS });
  return scan.metas.filter((m) => !m.deleted);
}

/** 같은 부모(또는 같은 DB) 형제의 마지막 순서 + 1. DB 행과 일반 페이지는 서로 다른 스코프다. */
export function nextSiblingOrder(metas: PageMeta[], scope: { parentId: string | null; databaseId: string | null }): number {
  const siblings = metas.filter((m) =>
    scope.databaseId ? m.databaseId === scope.databaseId : !m.databaseId && m.parentId === scope.parentId,
  );
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
}

export function normalizeTitle(title: string | undefined): string {
  return title?.trim() || UNTITLED;
}

/** 워크스페이스 내 제목이 겹치면 `(1)`, `(2)` … 를 붙인다. reserved 는 같은 배치에서 이미 쓴 제목. */
export function allocateUniqueTitle(metas: PageMeta[], preferred: string | undefined, reserved: Set<string>): string {
  const taken = new Set([...metas.map((m) => normalizeTitle(m.title)), ...reserved]);
  const base = normalizeTitle(preferred);
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/**
 * 신규 페이지 본문: 스키마 검증 + 블록 id 부여(클라 UniqueID 는 원격 시드 블록에 id 를 채우지 않는다)
 * + 크기 상한(협업 쓰기와 같은 350KB — 넘는 Pages.doc 은 클라 업서트 가드에 막혀 이후 저장이 끊긴다).
 */
export function prepareNewDoc(doc: DocNode | DocJson | null, opts: { freshIds?: boolean } = {}): DocJson {
  if (!doc) return EMPTY_PAGE_DOC;
  const schema = schemaFromSpec();
  const idTypes = blockIdTypesOf(schema);
  let json: DocJson;
  try {
    const node = PMNode.fromJSON(schema, normalizeLegacyJsonNode(doc as DocJson));
    node.check();
    json = node.toJSON() as DocJson;
  } catch (err) {
    throw new ToolError(`Invalid content: ${err instanceof Error ? err.message : String(err)}`);
  }
  const prepared = fillMissingBlockIds(opts.freshIds ? stripBlockIds(json, idTypes) : json, idTypes);
  const bytes = docByteLength(prepared);
  if (bytes > MAX_PAGE_DOC_BYTES) {
    throw new ToolError(`Page body is ${bytes} bytes (max ${MAX_PAGE_DOC_BYTES}). Split the content into several pages.`);
  }
  return prepared;
}

/** 본문에 새로 넣는 database 블록은 같은 워크스페이스의 살아 있는 DB 여야 한다(가짜 id·타 WS 참조 차단). */
export async function assertDatabasesUsable(ctx: McpContext, ids: string[], workspaceId: string): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return;
  const found = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Databases, keyName: "id", ids: unique,
    projection: "id, workspaceId, deletedAt",
  });
  const ok = new Set(found.filter((d) => d.workspaceId === workspaceId && !d.deletedAt).map((d) => String(d.id)));
  const missing = unique.filter((id) => !ok.has(id));
  if (missing.length > 0) throw new ToolError(`Unknown database id(s) in this workspace: ${missing.join(", ")}`);
}

/** candidate 가 ancestorId 자신이거나 그 자손인지(parentId 사슬, 순환 방어). */
export function isSelfOrDescendant(byId: Map<string, PageMeta>, candidateId: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let cursor: string | null = candidateId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** pageId 의 모든 자손 id(parentId 기준, 클라 deletePage 와 같은 범위). */
export function descendantIds(metas: PageMeta[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const m of metas) {
    if (!m.parentId) continue;
    children.set(m.parentId, [...(children.get(m.parentId) ?? []), m.id]);
  }
  const out: string[] = [];
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (out.includes(id) || id === rootId) continue;
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}
