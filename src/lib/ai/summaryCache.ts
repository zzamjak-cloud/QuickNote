// 동일 문서 요약 결과 캐시 — 세션 한정(sessionStorage), 상한 20엔트리.
// key: workspace + 대상 id + contentHash + model

const STORAGE_KEY = "quicknote.ai.summaryCache.v1";
const MAX_ENTRIES = 20;

export type SummaryCacheEntry = {
  markdown: string;
  model: string;
  createdAt: number;
};

type StoreShape = Record<string, SummaryCacheEntry>;

function readStore(): StoreShape {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota 초과 등은 무시
  }
}

/**
 * 컨텍스트 내용 지문 — 전체 본문 FNV-1a 해시.
 * 양끝 샘플만 해시하면 총 길이가 같은 중간 편집을 놓쳐 stale 요약을 돌려주므로 전량 해시.
 * (~100KB 상한 문자열이라 비용 무시 가능)
 */
export function hashAiContextMarkdown(markdown: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i += 1) {
    h ^= markdown.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${markdown.length.toString(16)}-${h.toString(16)}`;
}

export function buildSummaryCacheKey(args: {
  workspaceId: string;
  pageId?: string | null;
  databaseId?: string | null;
  contentHash: string;
  model: string;
}): string {
  const target = args.pageId
    ? `p:${args.pageId}`
    : args.databaseId
      ? `d:${args.databaseId}`
      : "none";
  return `${args.workspaceId}|${target}|${args.contentHash}|${args.model}`;
}

export function getSummaryCache(key: string): SummaryCacheEntry | null {
  const store = readStore();
  return store[key] ?? null;
}

export function setSummaryCache(key: string, entry: SummaryCacheEntry): void {
  const store = readStore();
  store[key] = entry;
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    // 오래된 것부터 제거
    const sorted = keys
      .map((k) => ({ k, t: store[k]!.createdAt }))
      .sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i += 1) {
      delete store[sorted[i]!.k];
    }
  }
  writeStore(store);
}
