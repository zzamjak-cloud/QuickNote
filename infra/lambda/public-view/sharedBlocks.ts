// 공개 페이지 doc 의 sharedBlockId 를 서버 최신 data 로 hydrate하고 공개 범위만 남긴다.
// 클라이언트 변환 전 원본 Function URL 응답 자체가 안전해야 하므로 메뉴 필터는 서버에서 수행한다.
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

const MAX_DEPTH = 200;
const MAX_SHARED_BLOCKS_PER_PAGE = 200;
const MAX_ITEMS = 50;
const MAX_EXTERNAL_PUBLISH_LOOKUPS = 100;
const DEFAULT_GALLERY_HEIGHT_PX = 320;
const MIN_GALLERY_HEIGHT_PX = 180;
const MAX_GALLERY_HEIGHT_PX = 800;
const SHARED_BLOCK_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const PAGE_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const PUBLIC_ROOT_HREF_RE = /^\/p\/[A-Za-z0-9_-]{16,64}$/;

type SharedBlockRow = {
  id?: string;
  workspaceId?: string;
  kind?: string;
  data?: unknown;
  deletedAt?: string | null;
};

function objectValue(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function sanitizeDropdownData(
  raw: unknown,
  publishedPageIds: ReadonlySet<string>,
  independentlyPublishedHrefs: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const value = objectValue(raw);
  const rows = Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS) : [];
  const items = rows.flatMap((row, index) => {
    const item = objectValue(row);
    if (!item) return [];
    const pageId = text(item.pageId, 128);
    if (!pageId) return [];
    const rawHref = independentlyPublishedHrefs.get(pageId);
    const href = rawHref && PUBLIC_ROOT_HREF_RE.test(rawHref) ? rawHref : null;
    // 현재 게시 트리 밖 항목은 같은 워크스페이스에서 별도 게시 중인 페이지로
    // 서버가 검증한 경우에만 공개한다. 저장 data의 href는 절대 신뢰하지 않는다.
    if (!publishedPageIds.has(pageId) && !href) return [];
    return [{
      id: text(item.id, 200) || `menu-${index}`,
      label: text(item.label, 100),
      pageId,
      ...(href ? { href } : {}),
    }];
  });
  return { kind: "dropdown-menu", items };
}

function collectDropdownTargetPageIds(
  raw: unknown,
  publishedPageIds: ReadonlySet<string>,
  out: Set<string>,
): void {
  const value = objectValue(raw);
  const rows = Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS) : [];
  for (const row of rows) {
    if (out.size >= MAX_EXTERNAL_PUBLISH_LOOKUPS) return;
    const item = objectValue(row);
    const pageId = text(item?.pageId, 128);
    if (PAGE_ID_RE.test(pageId) && !publishedPageIds.has(pageId)) out.add(pageId);
  }
}

function collectIndependentDropdownTargets(args: {
  pageDoc: unknown;
  rows: ReadonlyMap<string, SharedBlockRow>;
  publishedPageIds: ReadonlySet<string>;
}): string[] {
  const targets = new Set<string>();
  for (const row of args.rows.values()) {
    if (row.kind !== "dropdown-menu") continue;
    collectDropdownTargetPageIds(row.data, args.publishedPageIds, targets);
    if (targets.size >= MAX_EXTERNAL_PUBLISH_LOOKUPS) return Array.from(targets);
  }

  // sharedBlockId가 없는 레거시 인라인 블록만 attrs.data를 신뢰한다.
  // id가 있는 블록은 서버 SharedBlock 레코드만 권위 데이터로 사용한다.
  const walk = (node: unknown, depth: number): void => {
    if (
      targets.size >= MAX_EXTERNAL_PUBLISH_LOOKUPS ||
      !node ||
      typeof node !== "object" ||
      depth > MAX_DEPTH
    ) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const attrs = objectValue(record.attrs);
    if (
      record.type === "dropdownMenuBlock" &&
      attrs &&
      !text(attrs.sharedBlockId, 128)
    ) {
      collectDropdownTargetPageIds(attrs.data, args.publishedPageIds, targets);
    }
    if (Array.isArray(record.content)) walk(record.content, depth + 1);
  };
  walk(args.pageDoc, 0);
  return Array.from(targets);
}

function sanitizeGalleryData(raw: unknown): Record<string, unknown> {
  const value = objectValue(raw);
  const rows = Array.isArray(value?.images) ? value.images.slice(0, MAX_ITEMS) : [];
  const images = rows.flatMap((row, index) => {
    const image = objectValue(row);
    if (!image) return [];
    const src = text(image.src, 2_000);
    if (!src) return [];
    return [{
      id: text(image.id, 200) || `image-${index}`,
      src,
      alt: text(image.alt, 300),
    }];
  });
  const intervalRaw = Number(value?.intervalMs);
  const intervalMs = Number.isFinite(intervalRaw)
    ? Math.min(15_000, Math.max(3_000, Math.round(intervalRaw)))
    : 5_000;
  const heightRaw = Number(value?.heightPx);
  const heightPx = Number.isFinite(heightRaw)
    ? Math.min(MAX_GALLERY_HEIGHT_PX, Math.max(MIN_GALLERY_HEIGHT_PX, Math.round(heightRaw)))
    : DEFAULT_GALLERY_HEIGHT_PX;
  return { kind: "gallery", images, intervalMs, heightPx };
}

function collectSharedBlockIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const attrs = objectValue(record.attrs);
    if (
      (record.type === "dropdownMenuBlock" || record.type === "galleryBlock") &&
      attrs &&
      typeof attrs.sharedBlockId === "string" &&
      SHARED_BLOCK_ID_RE.test(attrs.sharedBlockId) &&
      ids.size < MAX_SHARED_BLOCKS_PER_PAGE
    ) {
      ids.add(attrs.sharedBlockId);
    }
    if (Array.isArray(record.content)) walk(record.content, depth + 1);
  };
  walk(doc, 0);
  return ids;
}

export function hasSharedBlockNodes(doc: unknown): boolean {
  let found = false;
  const walk = (node: unknown, depth: number): void => {
    if (found || !node || typeof node !== "object") return;
    if (depth > MAX_DEPTH) {
      // 상한 아래에 공유 블록이 숨어 있을 수 있으므로 hydration 경로를 강제한다.
      // hydratePublicSharedBlocks는 이 서브트리를 fail-closed로 제거한다.
      found = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.type === "dropdownMenuBlock" || record.type === "galleryBlock") {
      found = true;
      return;
    }
    if (Array.isArray(record.content)) walk(record.content, depth + 1);
  };
  walk(doc, 0);
  return found;
}

async function loadSharedBlocks(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  ids: ReadonlySet<string>;
  workspaceId: string;
}): Promise<Map<string, SharedBlockRow>> {
  const out = new Map<string, SharedBlockRow>();
  const ids = Array.from(args.ids);
  for (let i = 0; i < ids.length; i += 100) {
    const result = await args.doc.send(
      new BatchGetCommand({
        RequestItems: {
          [args.tableName]: {
            Keys: ids.slice(i, i + 100).map((id) => ({ id })),
            ProjectionExpression: "id, workspaceId, kind, #data, deletedAt",
            ExpressionAttributeNames: { "#data": "data" },
          },
        },
      }),
    );
    for (const item of result.Responses?.[args.tableName] ?? []) {
      const row = item as SharedBlockRow;
      if (
        row.id &&
        row.workspaceId === args.workspaceId &&
        !row.deletedAt &&
        (row.kind === "dropdown-menu" || row.kind === "gallery")
      ) {
        out.set(row.id, row);
      }
    }
  }
  return out;
}

export async function hydratePublicSharedBlocks(args: {
  docClient: DynamoDBDocumentClient;
  tableName: string;
  workspaceId: string;
  publishedPageIds: ReadonlySet<string>;
  pageDoc: unknown;
  resolvePublishedPageHrefs?: (
    pageIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
}): Promise<unknown> {
  const ids = collectSharedBlockIds(args.pageDoc);
  const rows = await loadSharedBlocks({
    doc: args.docClient,
    tableName: args.tableName,
    ids,
    workspaceId: args.workspaceId,
  });
  const externalTargets = collectIndependentDropdownTargets({
    pageDoc: args.pageDoc,
    rows,
    publishedPageIds: args.publishedPageIds,
  });
  let independentlyPublishedHrefs: ReadonlyMap<string, string> = new Map();
  if (externalTargets.length > 0 && args.resolvePublishedPageHrefs) {
    try {
      independentlyPublishedHrefs = await args.resolvePublishedPageHrefs(externalTargets);
    } catch {
      // 독립 게시 상태 조회 실패는 공개 범위를 넓히지 않고 해당 항목만 숨긴다.
      independentlyPublishedHrefs = new Map();
    }
  }

  const walk = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== "object") return node;
    // 깊이 상한 초과에서 원본 node를 반환하면 서버 최신 레코드로 검증하지 않은 stale attrs가
    // 그대로 공개될 수 있다. 초과 서브트리는 통째로 제거해 비공개 label/pageId를 숨긴다.
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(node)) {
      return node
        .map((child) => walk(child, depth + 1))
        .filter((child) => child !== null);
    }
    const record = node as Record<string, unknown>;
    const attrs = objectValue(record.attrs);
    let next = record;
    if (attrs && (record.type === "dropdownMenuBlock" || record.type === "galleryBlock")) {
      const sharedBlockId = text(attrs.sharedBlockId, 128);
      const row = sharedBlockId ? rows.get(sharedBlockId) : undefined;
      const expectedKind = record.type === "dropdownMenuBlock" ? "dropdown-menu" : "gallery";
      // ID가 있는데 서버 row가 없거나 kind/workspace가 다르면 복사본의 오래된 data를 노출하지 않는다.
      const source = sharedBlockId
        ? row?.kind === expectedKind
          ? row.data
          : null
        : attrs.data;
      const data = expectedKind === "dropdown-menu"
        ? sanitizeDropdownData(
            source,
            args.publishedPageIds,
            independentlyPublishedHrefs,
          )
        : sanitizeGalleryData(source);
      next = {
        ...record,
        attrs: {
          ...attrs,
          data: JSON.stringify(data),
          publicMode: true,
        },
      };
    }
    if (Array.isArray(next.content)) {
      next = {
        ...next,
        content: next.content
          .map((child) => walk(child, depth + 1))
          .filter((child) => child !== null),
      };
    }
    return next;
  };
  return walk(args.pageDoc, 0);
}
