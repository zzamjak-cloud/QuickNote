// 워크스페이스 페이지 메타 스캔 — byWorkspaceMetaUpdatedAt GSI(INCLUDE 프로젝션, 본문 제외)를
// updatedAt 내림차순으로 페이지네이션한다. 서버 검색 인덱스가 없어(P4 예정) 상한을 두고 스캔한다.
import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type PageMeta = {
  id: string;
  workspaceId: string;
  title: string;
  parentId: string | null;
  databaseId: string | null;
  updatedAt: string;
  deleted: boolean;
  /** 형제 정렬 키(Pages.order 는 숫자 문자열). */
  order: number;
};

export type MetaScanResult = { metas: PageMeta[]; truncated: boolean };

/** 한 번의 툴 호출에서 읽을 메타 상한(전체 워크스페이스 합산). */
export const MAX_SCANNED_METAS = 5000;

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function toPageMeta(item: Record<string, unknown>): PageMeta {
  return {
    id: String(item.id ?? ""),
    workspaceId: String(item.workspaceId ?? ""),
    title: typeof item.title === "string" ? item.title : "",
    parentId: str(item.parentId),
    databaseId: str(item.databaseId),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    deleted: str(item.deletedAt) !== null,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
  };
}

// ── 워크스페이스 메타 캐시(컨테이너 단위) ──
// 메타 스캔은 최대 5000건 Query 라 fetch·search 마다 반복하면 RCU 가 크다(ProjectionExpression 은 RCU 를 줄이지 않는다).
// 키 = (DDB 클라이언트, 테이블, 워크스페이스), TTL 30초. MCP 쓰기는 invalidateWorkspaceMetas 로 즉시 무효화한다.
export const META_CACHE_TTL_MS = 30_000;
type CacheEntry = { at: number; budget: number; result: MetaScanResult };
const metaCache = new WeakMap<DynamoDBDocumentClient, Map<string, CacheEntry>>();

function cacheOf(doc: DynamoDBDocumentClient): Map<string, CacheEntry> {
  let m = metaCache.get(doc);
  if (!m) {
    m = new Map();
    metaCache.set(doc, m);
  }
  return m;
}

function cached(entry: CacheEntry | undefined, budget: number, nowMs: number): MetaScanResult | null {
  if (!entry || nowMs - entry.at >= META_CACHE_TTL_MS) return null;
  // 더 작은 예산으로 잘린 결과는 더 큰 예산 요청에 쓸 수 없다.
  if (entry.result.truncated && entry.budget < budget) return null;
  if (entry.result.metas.length <= budget) return entry.result;
  return { metas: entry.result.metas.slice(0, budget), truncated: true };
}

/** 쓰기 후 무효화 — 다음 조회가 새로 스캔한다. */
export function invalidateWorkspaceMetas(doc: DynamoDBDocumentClient, pagesTable: string, workspaceId: string): void {
  metaCache.get(doc)?.delete(`${pagesTable}|${workspaceId}`);
}

/**
 * 워크스페이스 메타(본문 제외)를 updatedAt 내림차순으로. fresh 면 캐시를 건너뛰고 새로 읽어 캐시를 갱신한다
 * (쓰기 툴의 형제 순서·제목 중복 검사는 최신이어야 한다).
 */
export async function scanWorkspaceMetas(args: {
  doc: DynamoDBDocumentClient;
  pagesTable: string;
  workspaceId: string;
  budget: number;
  fresh?: boolean;
  nowMs?: number;
}): Promise<MetaScanResult> {
  const nowMs = args.nowMs ?? Date.now();
  const key = `${args.pagesTable}|${args.workspaceId}`;
  const hit = args.fresh ? null : cached(cacheOf(args.doc).get(key), args.budget, nowMs);
  if (hit) return hit;
  const result = await queryWorkspaceMetas(args);
  cacheOf(args.doc).set(key, { at: nowMs, budget: args.budget, result });
  return result;
}

async function queryWorkspaceMetas(args: {
  doc: DynamoDBDocumentClient;
  pagesTable: string;
  workspaceId: string;
  budget: number;
}): Promise<MetaScanResult> {
  const metas: PageMeta[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.pagesTable,
        IndexName: "byWorkspaceMetaUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
        // order 는 DynamoDB 예약어라 별칭으로 읽는다.
        ProjectionExpression: "id, workspaceId, title, parentId, databaseId, updatedAt, deletedAt, #o",
        ExpressionAttributeNames: { "#o": "order" },
        ScanIndexForward: false,
        Limit: Math.min(1000, args.budget - metas.length),
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items ?? []) metas.push(toPageMeta(item as Record<string, unknown>));
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey && metas.length < args.budget);
  return { metas, truncated: Boolean(lastKey) };
}

/** 여러 워크스페이스를 공유 예산으로 스캔한다. 예산 소진 시 truncated. */
export async function scanMetasAcross(args: {
  doc: DynamoDBDocumentClient;
  pagesTable: string;
  workspaceIds: string[];
  maxItems?: number;
}): Promise<MetaScanResult> {
  const max = args.maxItems ?? MAX_SCANNED_METAS;
  const metas: PageMeta[] = [];
  let truncated = false;
  for (const workspaceId of args.workspaceIds) {
    const budget = max - metas.length;
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const r = await scanWorkspaceMetas({ doc: args.doc, pagesTable: args.pagesTable, workspaceId, budget });
    metas.push(...r.metas);
    truncated = truncated || r.truncated;
  }
  return { metas, truncated };
}

/** 조상 제목 경로(가까운 부모부터 최대 depth 개, 루트→부모 순으로 반환). */
export function ancestorTitles(meta: PageMeta, byId: Map<string, PageMeta>, depth = 3): string[] {
  const out: string[] = [];
  let cursor = meta.parentId ? byId.get(meta.parentId) : undefined;
  const seen = new Set<string>([meta.id]);
  while (cursor && out.length < depth && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    out.unshift(cursor.title || "Untitled");
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return out;
}
