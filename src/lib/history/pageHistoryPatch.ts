import type { GqlPageHistoryEntry } from "../sync/graphql/operations";
import type { PageSnapshot } from "../../types/history";

type PagePatchOp = {
  op: "set" | "unset";
  path: Array<string | number>;
  value?: unknown;
};

const CACHE_KEY = "quicknote.pageHistoryPreview.v1";
const CACHE_MAX = 300;

type CachedSnapshot = {
  key: string;
  ts: number;
  snapshot: PageSnapshot;
};

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseAwsJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPatchOpArray(value: unknown): value is PagePatchOp[] {
  return Array.isArray(value) && value.every((op) => {
    if (!isRecord(op)) return false;
    if (op.op !== "set" && op.op !== "unset") return false;
    return Array.isArray(op.path);
  });
}

function setPath(
  target: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) return cloneJson(value as Record<string, unknown>);
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const nextKey = path[i + 1];
    if (Array.isArray(cursor)) {
      if (cursor[key as number] == null) {
        cursor[key as number] = typeof nextKey === "number" ? [] : {};
      }
      cursor = cursor[key as number];
    } else {
      const obj = cursor as Record<string, unknown>;
      if (obj[key] == null) obj[key] = typeof nextKey === "number" ? [] : {};
      cursor = obj[key];
    }
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cursor)) cursor[last as number] = cloneJson(value);
  else (cursor as Record<string, unknown>)[last] = cloneJson(value);
  return target;
}

function unsetPath(target: Record<string, unknown>, path: Array<string | number>): void {
  if (path.length === 0) return;
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    cursor = Array.isArray(cursor)
      ? cursor[key as number]
      : (cursor as Record<string, unknown>)[key];
    if (cursor == null) return;
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cursor)) cursor.splice(last as number, 1);
  else delete (cursor as Record<string, unknown>)[last];
}

function applyPagePatch(
  base: PageSnapshot | null,
  patch: unknown,
): PageSnapshot | null {
  const parsedPatch = parseAwsJson(patch);
  if (!isPatchOpArray(parsedPatch)) {
    if (!isRecord(parsedPatch)) return base;
    return { ...(base ?? {}), ...cloneJson(parsedPatch) } as PageSnapshot;
  }
  let next: Record<string, unknown> = base ? cloneJson(base) : {};
  for (const op of parsedPatch) {
    if (op.op === "set") next = setPath(next, op.path, op.value);
    else unsetPath(next, op.path);
  }
  return typeof next.id === "string" ? (next as PageSnapshot) : null;
}

function cacheKey(workspaceId: string, pageId: string, historyId: string): string {
  return `${workspaceId}::${pageId}::${historyId}`;
}

function readCache(): CachedSnapshot[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(items: CachedSnapshot[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(items.slice(-CACHE_MAX)),
    );
  } catch {
    /* 캐시는 실패해도 기능에 영향이 없어야 한다. */
  }
}

function getCachedSnapshot(key: string): PageSnapshot | null {
  const hit = readCache().find((item) => item.key === key);
  return hit ? cloneJson(hit.snapshot) : null;
}

function putCachedSnapshot(key: string, snapshot: PageSnapshot): void {
  const items = readCache().filter((item) => item.key !== key);
  items.push({ key, ts: Date.now(), snapshot: cloneJson(snapshot) });
  writeCache(items.sort((a, b) => a.ts - b.ts));
}

function sortHistoryAsc(entries: GqlPageHistoryEntry[]): GqlPageHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const at = Date.parse(a.createdAt) || 0;
    const bt = Date.parse(b.createdAt) || 0;
    if (at !== bt) return at - bt;
    return a.historyId.localeCompare(b.historyId);
  });
}

export function buildPageHistorySnapshotMap(
  entries: GqlPageHistoryEntry[],
  pageId: string,
  workspaceId: string,
): Map<string, PageSnapshot> {
  const out = new Map<string, PageSnapshot>();
  let snapshot: PageSnapshot | null = null;
  for (const entry of sortHistoryAsc(entries)) {
    if (entry.workspaceId !== workspaceId) continue;
    const key = cacheKey(workspaceId, pageId, entry.historyId);
    const cached = getCachedSnapshot(key);
    if (cached) {
      snapshot = cached;
      out.set(entry.historyId, cached);
      continue;
    }
    const anchor = parseAwsJson(entry.anchor);
    if (isRecord(anchor)) snapshot = cloneJson(anchor as PageSnapshot);
    snapshot = applyPagePatch(snapshot, entry.patch);
    if (snapshot) {
      out.set(entry.historyId, snapshot);
      putCachedSnapshot(key, snapshot);
    }
  }
  return out;
}

export function getPreviousPageHistorySnapshot(
  entries: GqlPageHistoryEntry[],
  pageId: string,
  workspaceId: string,
  historyId: string,
): PageSnapshot | null {
  const sorted = sortHistoryAsc(entries).filter((entry) => entry.workspaceId === workspaceId);
  const idx = sorted.findIndex((entry) => entry.historyId === historyId);
  if (idx <= 0) return null;
  const previous = sorted[idx - 1];
  if (!previous) return null;
  return buildPageHistorySnapshotMap(entries, pageId, workspaceId).get(previous.historyId) ?? null;
}
