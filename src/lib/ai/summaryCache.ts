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

/** 컨텍스트 내용 지문 — 본문 길이 + 양끝 샘플로 변경 감지. */
export function hashAiContextMarkdown(markdown: string): string {
  const n = markdown.length;
  const head = markdown.slice(0, 64);
  const tail = n > 64 ? markdown.slice(-64) : "";
  let h = n >>> 0;
  const sample = head + tail;
  for (let i = 0; i < sample.length; i += 1) {
    h = (Math.imul(31, h) + sample.charCodeAt(i)) >>> 0;
  }
  return `${n.toString(16)}-${h.toString(16)}`;
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
