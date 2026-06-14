import { isRecord } from "../util/typeGuards";

export type HistoryPatchOp = {
  op: "set" | "unset";
  path: Array<string | number>;
  value?: unknown;
};

export type HistoryPatchEntryLike = {
  workspaceId: string;
  historyId: string;
  createdAt: string;
  snapshot?: unknown;
  anchor?: unknown;
  patch?: unknown;
};

type CachedSnapshot<TSnapshot> = {
  key: string;
  ts: number;
  snapshot: TSnapshot;
};

type HistoryPatchEngineOptions = {
  cacheKey: string;
  cacheMax?: number;
};

const DEFAULT_CACHE_MAX = 300;

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseAwsJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPatchOpArray(value: unknown): value is HistoryPatchOp[] {
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

function hasSnapshotId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string";
}

function applyHistoryPatch<TSnapshot extends { id: string }>(
  base: TSnapshot | null,
  patch: unknown,
): TSnapshot | null {
  const parsedPatch = parseAwsJson(patch);
  if (!isPatchOpArray(parsedPatch)) {
    if (!isRecord(parsedPatch)) return base;
    const next = { ...(base ?? {}), ...cloneJson(parsedPatch) };
    return hasSnapshotId(next) ? (next as TSnapshot) : null;
  }
  let next: Record<string, unknown> = base ? cloneJson(base) : {};
  for (const op of parsedPatch) {
    if (op.op === "set") next = setPath(next, op.path, op.value);
    else unsetPath(next, op.path);
  }
  return hasSnapshotId(next) ? (next as TSnapshot) : null;
}

function cacheKey(workspaceId: string, entityId: string, historyId: string): string {
  return `${workspaceId}::${entityId}::${historyId}`;
}

function readCacheMap<TSnapshot extends { id: string }>(
  storageKey: string,
): Map<string, CachedSnapshot<TSnapshot>> {
  const map = new Map<string, CachedSnapshot<TSnapshot>>();
  if (typeof localStorage === "undefined") return map;
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const item of parsed as Array<CachedSnapshot<unknown>>) {
        if (item && typeof item.key === "string" && hasSnapshotId(item.snapshot)) {
          map.set(item.key, item as CachedSnapshot<TSnapshot>);
        }
      }
    }
  } catch {
    /* 캐시 파싱 실패는 무시한다. */
  }
  return map;
}

function writeCacheMap<TSnapshot>(
  storageKey: string,
  cacheMax: number,
  map: Map<string, CachedSnapshot<TSnapshot>>,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const items = Array.from(map.values())
      .sort((a, b) => a.ts - b.ts)
      .slice(-cacheMax);
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    /* 캐시는 실패해도 기능에 영향이 없어야 한다. */
  }
}

function sortHistoryAsc<TEntry extends HistoryPatchEntryLike>(entries: TEntry[]): TEntry[] {
  return [...entries].sort((a, b) => {
    const at = Date.parse(a.createdAt) || 0;
    const bt = Date.parse(b.createdAt) || 0;
    if (at !== bt) return at - bt;
    return a.historyId.localeCompare(b.historyId);
  });
}

export function createHistoryPatchEngine<
  TEntry extends HistoryPatchEntryLike,
  TSnapshot extends { id: string },
>(options: HistoryPatchEngineOptions) {
  const cacheMax = options.cacheMax ?? DEFAULT_CACHE_MAX;

  function buildSnapshotMap(
    entries: TEntry[],
    entityId: string,
    workspaceId: string,
  ): Map<string, TSnapshot> {
    const out = new Map<string, TSnapshot>();
    const cache = readCacheMap<TSnapshot>(options.cacheKey);
    let snapshot: TSnapshot | null = null;
    let dirty = false;

    for (const entry of sortHistoryAsc(entries)) {
      if (entry.workspaceId !== workspaceId) continue;
      const direct = parseAwsJson(entry.snapshot);
      if (hasSnapshotId(direct)) {
        snapshot = direct as TSnapshot;
        out.set(entry.historyId, snapshot);
        continue;
      }

      const key = cacheKey(workspaceId, entityId, entry.historyId);
      const cached = cache.get(key);
      if (cached) {
        snapshot = cached.snapshot;
        out.set(entry.historyId, snapshot);
        continue;
      }

      const anchor = parseAwsJson(entry.anchor);
      if (hasSnapshotId(anchor)) snapshot = cloneJson(anchor as TSnapshot);
      snapshot = applyHistoryPatch(snapshot, entry.patch);
      if (snapshot) {
        out.set(entry.historyId, snapshot);
        cache.set(key, { key, ts: Date.now(), snapshot });
        dirty = true;
      }
    }

    if (dirty) writeCacheMap(options.cacheKey, cacheMax, cache);
    return out;
  }

  function getPreviousSnapshot(
    entries: TEntry[],
    entityId: string,
    workspaceId: string,
    historyId: string,
  ): TSnapshot | null {
    const sorted = sortHistoryAsc(entries).filter((entry) => entry.workspaceId === workspaceId);
    const idx = sorted.findIndex((entry) => entry.historyId === historyId);
    if (idx <= 0) return null;
    const previous = sorted[idx - 1];
    if (!previous) return null;
    return buildSnapshotMap(entries, entityId, workspaceId).get(previous.historyId) ?? null;
  }

  return { buildSnapshotMap, getPreviousSnapshot };
}
