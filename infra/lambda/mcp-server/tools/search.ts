// search — 제목 매칭(정확>접두>포함) 우선, 남는 자리는 최근 수정 문서 본문 매칭으로 채운다.
// 서버 검색 인덱스가 없어 메타 스캔·본문 로드 모두 상한을 두고 truncated 로 알린다.
import { z } from "zod";
import { requireWorkspace } from "../access";
import type { McpContext } from "../context";
import { databasePaths } from "../dbPath";
import { batchGetByKey } from "../ddb";
import { ancestorTitles, scanMetasAcross, type PageMeta } from "../pageScan";
import { blockTexts, findSnippet, normalizeForMatch, parseDocJson } from "../text";
import { accessibleWorkspaces } from "./listWorkspaces";

/** 본문 매칭을 위해 로드할 최근 문서 상한. */
export const MAX_BODY_CANDIDATES = 100;
/** 본문 후보 읽기량 상한(UTF-8 바이트) — 큰 본문이 몰려도 Lambda 메모리·RCU 를 묶어 둔다. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** 상한을 넘기면 다음 묶음을 읽지 않도록 작게 나눠 읽는다. */
const BODY_BATCH = 20;

export const searchInputShape = {
  query: z.string().trim().min(1).max(200).describe("Text to search in page titles and bodies"),
  workspaceId: z.string().min(1).max(128).optional().describe("Limit to one workspace (from list_workspaces)"),
  limit: z.number().int().min(1).max(25).default(10).describe("Max results (1-25, default 10)"),
};
const searchInput = z.object(searchInputShape);
export type SearchInput = z.input<typeof searchInput>;

export type SearchResultType = "page" | "database-row" | "full-page-database";

export type SearchResult = {
  id: string;
  title: string;
  workspaceId: string;
  path: string[];
  type: SearchResultType;
  snippet: string | null;
  updatedAt: string;
  match: "title" | "body";
};

/** 제목 매치 순위: 0 정확, 1 접두, 2 포함, null 불일치. */
export function titleRank(title: string, queryNorm: string): number | null {
  const t = normalizeForMatch(title);
  if (t === queryNorm) return 0;
  if (t.startsWith(queryNorm)) return 1;
  if (t.includes(queryNorm)) return 2;
  return null;
}

export function rankTitleMatches(metas: PageMeta[], queryNorm: string): PageMeta[] {
  return metas
    .map((meta) => ({ meta, rank: titleRank(meta.title, queryNorm) }))
    .filter((x): x is { meta: PageMeta; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.meta.updatedAt.localeCompare(a.meta.updatedAt))
    .map((x) => x.meta);
}

function cellTexts(dbCells: unknown): string[] {
  let cells = dbCells;
  if (typeof cells === "string") {
    try {
      cells = JSON.parse(cells);
    } catch {
      return [];
    }
  }
  if (!cells || typeof cells !== "object") return [];
  return Object.values(cells as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map(String);
}

async function targetWorkspaceIds(ctx: McpContext, workspaceId?: string): Promise<string[]> {
  if (workspaceId) {
    await requireWorkspace(ctx, workspaceId);
    return [workspaceId];
  }
  return (await accessibleWorkspaces(ctx)).map((w) => w.id);
}

type BodyHit = { meta: PageMeta; snippet: string; fullPage: boolean };
type BodyScan = { hits: BodyHit[]; searched: number; bytesRead: number; capped: boolean };

function itemBytes(item: Record<string, unknown>): number {
  const size = (v: unknown) => (v == null ? 0 : Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8"));
  return size(item.doc) + size(item.dbCells);
}

/** 최근 문서부터 본문(필요한 속성만 프로젝션)을 묶음으로 읽어 매칭한다. 결과 수·읽기량 상한에 닿으면 멈춘다. */
export async function findBodyHits(ctx: McpContext, candidates: PageMeta[], queryNorm: string, max: number, maxBytes = MAX_BODY_BYTES): Promise<BodyScan> {
  const scan: BodyScan = { hits: [], searched: 0, bytesRead: 0, capped: false };
  for (let i = 0; i < candidates.length && scan.hits.length < max; i += BODY_BATCH) {
    if (scan.bytesRead >= maxBytes) {
      scan.capped = true;
      break;
    }
    const chunk = candidates.slice(i, i + BODY_BATCH);
    const items = await batchGetByKey({
      doc: ctx.doc,
      tableName: ctx.tables.Pages,
      keyName: "id",
      ids: chunk.map((m) => m.id),
      projection: "id, doc, dbCells, fullPageDatabaseId",
    });
    const byId = new Map(items.map((it) => [String(it.id), it]));
    for (const meta of chunk) {
      const item = byId.get(meta.id);
      scan.searched += 1;
      if (!item) continue;
      scan.bytesRead += itemBytes(item);
      if (scan.hits.length >= max) continue;
      const snippet = findSnippet([...blockTexts(parseDocJson(item.doc)), ...cellTexts(item.dbCells)], queryNorm);
      if (snippet) scan.hits.push({ meta, snippet, fullPage: Boolean(item.fullPageDatabaseId) });
    }
  }
  return scan;
}

/** 제목 매치 결과의 풀페이지 DB 여부만 가볍게 조회(본문은 읽지 않는다). */
async function fullPageIds(ctx: McpContext, metas: PageMeta[]): Promise<Set<string>> {
  const items = await batchGetByKey({
    doc: ctx.doc,
    tableName: ctx.tables.Pages,
    keyName: "id",
    ids: metas.map((m) => m.id),
    projection: "id, fullPageDatabaseId",
  });
  return new Set(items.filter((it) => it.fullPageDatabaseId).map((it) => String(it.id)));
}

type PathIndex = { byId: Map<string, PageMeta>; dbPaths: Map<string, string[]> };

function toResult(
  meta: PageMeta,
  paths: PathIndex,
  extra: { match: "title" | "body"; snippet: string | null; fullPage: boolean },
): SearchResult {
  const type: SearchResultType = meta.databaseId ? "database-row" : extra.fullPage ? "full-page-database" : "page";
  return {
    id: meta.id,
    title: meta.title || "Untitled",
    workspaceId: meta.workspaceId,
    path: meta.databaseId ? paths.dbPaths.get(meta.databaseId) ?? [] : ancestorTitles(meta, paths.byId),
    type,
    snippet: extra.snippet,
    updatedAt: meta.updatedAt,
    match: extra.match,
  };
}

export async function searchTool(ctx: McpContext, raw: SearchInput) {
  const input = searchInput.parse(raw);
  const queryNorm = normalizeForMatch(input.query);
  const workspaceIds = await targetWorkspaceIds(ctx, input.workspaceId);
  const scan = await scanMetasAcross({ doc: ctx.doc, pagesTable: ctx.tables.Pages, workspaceIds });
  const live = scan.metas.filter((m) => !m.deleted);
  const byId = new Map(live.map((m) => [m.id, m]));

  const titleHits = rankTitleMatches(live, queryNorm).slice(0, input.limit);
  const hitIds = new Set(titleHits.map((m) => m.id));
  const remaining = input.limit - titleHits.length;
  const candidates = remaining > 0 ? live.filter((m) => !hitIds.has(m.id)).slice(0, MAX_BODY_CANDIDATES) : [];
  const empty: BodyScan = { hits: [], searched: 0, bytesRead: 0, capped: false };
  const [fullPages, body] = await Promise.all([
    fullPageIds(ctx, titleHits),
    candidates.length > 0 ? findBodyHits(ctx, candidates, queryNorm, remaining) : Promise.resolve(empty),
  ]);
  const bodyHits = body.hits;

  const rowDbIds = [...titleHits, ...bodyHits.map((h) => h.meta)].map((m) => m.databaseId ?? "");
  const paths: PathIndex = { byId, dbPaths: await databasePaths(ctx, rowDbIds, live) };

  return {
    results: [
      ...titleHits.map((m) => toResult(m, paths, { match: "title", snippet: null, fullPage: fullPages.has(m.id) })),
      ...bodyHits.map((h) => toResult(h.meta, paths, { match: "body", snippet: h.snippet, fullPage: h.fullPage })),
    ],
    scannedPages: scan.metas.length,
    bodySearchedPages: body.searched,
    ...(body.capped ? { bodyReadCapped: true } : {}),
    truncated: scan.truncated,
  };
}
