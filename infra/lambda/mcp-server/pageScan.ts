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

export async function scanWorkspaceMetas(args: {
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
