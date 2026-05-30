export type EntityKind = "page" | "database";

type GuardEntry = {
  deletedAtMs: number;
  /** true 이면 TTL 과 무관하게 영구 차단(서버에서도 사라진 확정 상태). */
  permanent?: boolean;
};

export type LocalDeleteGuardChecker = (
  kind: EntityKind,
  id: string,
  workspaceId: string,
  remoteUpdatedAt: string,
) => boolean;

const LOCAL_DELETE_GUARDS_KEY = "quicknote.sync.localDeleteGuards.v1";
const LOCAL_DELETE_GUARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// permanent tombstone 도 무한 누적을 막기 위해 30일 후 자동 만료.
const PERMANENT_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function guardKey(kind: EntityKind, workspaceId: string, id: string): string {
  return `${kind}:${workspaceId}:${id}`;
}

function readGuards(): Record<string, GuardEntry> {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_DELETE_GUARDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, GuardEntry> : {};
  } catch {
    return {};
  }
}

function writeGuards(guards: Record<string, GuardEntry>): void {
  try {
    globalThis.localStorage?.setItem(LOCAL_DELETE_GUARDS_KEY, JSON.stringify(guards));
  } catch {
    // localStorage 비가용 환경에서는 세션 내 로컬 삭제 가드만 포기한다.
  }
}

function pruneGuards(guards: Record<string, GuardEntry>, nowMs: number): Record<string, GuardEntry> {
  const next: Record<string, GuardEntry> = {};
  for (const [key, entry] of Object.entries(guards)) {
    if (!entry || !Number.isFinite(entry.deletedAtMs)) continue;
    const age = nowMs - entry.deletedAtMs;
    // permanent tombstone 도 30일 경과 시 만료(무한 누적 방지).
    if (entry.permanent && age > PERMANENT_TOMBSTONE_TTL_MS) continue;
    if (!entry.permanent && age > LOCAL_DELETE_GUARD_TTL_MS) continue;
    next[key] = entry;
  }
  return next;
}

/** 앱 시작 시 localStorage 의 만료 guard 를 일괄 정리한다. */
export function pruneLocalDeleteGuardsOnStartup(): void {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_DELETE_GUARDS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const pruned = pruneGuards(parsed as Record<string, GuardEntry>, Date.now());
    globalThis.localStorage?.setItem(LOCAL_DELETE_GUARDS_KEY, JSON.stringify(pruned));
  } catch {
    // localStorage 비가용 환경에서는 조용히 무시.
  }
}

export function markLocallyDeletedEntity(
  kind: EntityKind,
  id: string,
  workspaceId: string,
  deletedAtMs = Date.now(),
): void {
  if (!id || !workspaceId) return;
  const guards = pruneGuards(readGuards(), deletedAtMs);
  const existing = guards[guardKey(kind, workspaceId, id)];
  // 이미 permanent 로 승격되어 있으면 다운그레이드 금지.
  if (existing?.permanent) {
    guards[guardKey(kind, workspaceId, id)] = {
      ...existing,
      deletedAtMs: Math.max(existing.deletedAtMs, deletedAtMs),
    };
  } else {
    guards[guardKey(kind, workspaceId, id)] = { deletedAtMs };
  }
  writeGuards(guards);
}

/**
 * 서버에서도 row 가 확정적으로 사라진 경우(영구삭제 성공 / softDelete 가 'resource-already-gone' 응답)
 * 호출. TTL 과 타임스탬프 무관하게 이후 모든 원격 응답을 차단한다.
 */
export function markPermanentlyDeletedEntity(
  kind: EntityKind,
  id: string,
  workspaceId: string,
): void {
  if (!id || !workspaceId) return;
  const now = Date.now();
  const guards = pruneGuards(readGuards(), now);
  const existing = guards[guardKey(kind, workspaceId, id)];
  guards[guardKey(kind, workspaceId, id)] = {
    deletedAtMs: Math.max(existing?.deletedAtMs ?? 0, now),
    permanent: true,
  };
  writeGuards(guards);
}

export function shouldIgnoreRemoteAfterLocalDelete(
  kind: EntityKind,
  id: string,
  workspaceId: string,
  remoteUpdatedAt: string,
): boolean {
  return createLocalDeleteGuardChecker()(kind, id, workspaceId, remoteUpdatedAt);
}

/** batch 적용 중 localStorage guard 를 한 번만 읽기 위한 checker 를 만든다. */
export function createLocalDeleteGuardChecker(nowMs = Date.now()): LocalDeleteGuardChecker {
  const guards = pruneGuards(readGuards(), nowMs);
  return (kind, id, workspaceId, remoteUpdatedAt) => {
    if (!id || !workspaceId) return false;
    const entry = guards[guardKey(kind, workspaceId, id)];
    if (!entry) return false;
    const remoteMs = Date.parse(remoteUpdatedAt);
    if (!Number.isFinite(remoteMs)) return false;
    // 서버에서 더 최신 버전이 살아난 경우(복구/재생성)는 local tombstone 보다 우선한다.
    // 이 조건이 없으면 한 번 영구 tombstone 이 잡힌 항목은 같은 PC에서 영구히 복구되지 않는다.
    if (entry.permanent) return remoteMs <= entry.deletedAtMs;
    return remoteMs <= entry.deletedAtMs;
  };
}

/** 영구 tombstone 여부 조회 (UI/디버그용). */
export function isPermanentlyDeletedEntity(
  kind: EntityKind,
  id: string,
  workspaceId: string,
): boolean {
  if (!id || !workspaceId) return false;
  const guards = pruneGuards(readGuards(), Date.now());
  const entry = guards[guardKey(kind, workspaceId, id)];
  return Boolean(entry?.permanent);
}

/** 사용자가 명시적으로 복원을 시도할 때만 가드를 제거. */
export function clearLocalDeleteGuard(
  kind: EntityKind,
  id: string,
  workspaceId: string,
): void {
  if (!id || !workspaceId) return;
  const guards = pruneGuards(readGuards(), Date.now());
  delete guards[guardKey(kind, workspaceId, id)];
  writeGuards(guards);
}
