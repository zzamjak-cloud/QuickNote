import type { OutboxEntry } from "./outbox/types";

/** 엔트리에 스코프된 워크스페이스 — 메타가 없으면 payload.workspaceId 로 보완(레거시 행). */
export function resolveEntryWorkspaceId(entry: OutboxEntry): string | null {
  const fromMeta = entry.workspaceId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  const p = entry.payload as { workspaceId?: unknown };
  return typeof p.workspaceId === "string" && p.workspaceId.length > 0
    ? p.workspaceId
    : null;
}

/**
 * 한 배치 안에서 현재 UI 워크스페이스에 해당하는 뮤테이션을 먼저 보낸다.
 * 다른 워크스페이스 대기 작업이 head 에 쌓여 있어도 보이는 편집 세션이 우선 전송된다.
 * enqueuedAt(FIFO) 순서는 동일 그룹 안에서 유지한다.
 */
export function sortOutboxBatchForFlush(
  batch: OutboxEntry[],
  uiWorkspaceId: string | null | undefined,
): OutboxEntry[] {
  const ws = typeof uiWorkspaceId === "string" ? uiWorkspaceId.trim() : "";
  if (!ws || batch.length <= 1) return [...batch];

  const rank = (e: OutboxEntry): number => {
    if (e.op === "updateMyClientPrefs") return 1;
    const ews = resolveEntryWorkspaceId(e);
    if (ews === ws) return 0;
    if (!ews) return 2;
    return 3;
  };

  return batch
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      const ra = rank(a.e);
      const rb = rank(b.e);
      if (ra !== rb) return ra - rb;
      return a.idx - b.idx;
    })
    .map(({ e }) => e);
}
