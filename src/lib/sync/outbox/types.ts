// 변경 발생 시 즉시 영속 큐에 적재 → 백그라운드 워커가 AppSync mutation 으로 flush.
// 같은 (op, payload.id) 의 새 entry 는 dedupeKey 로 기존을 덮어써 마지막 본만 보냄.

export type OutboxOp =
  | "upsertPage"
  | "upsertDatabase"
  | "softDeletePage"
  | "softDeleteDatabase"
  | "updateMyClientPrefs";

/** outbox 엔트리에 붙는 엔티티 분류(플러시·관측용). */
export type OutboxEntityType = "page" | "database" | "memberPrefs";

export type OutboxEntry = {
  id: string;
  op: OutboxOp;
  payload: unknown;
  enqueuedAt: number;
  attempts: number;
  lastErrorAt?: number;
  dedupeKey: string;
  /** enqueue 시점 payload 기준 워크스페이스(null 이면 멤버 전역 prefs 등). 레거시 행은 미설정일 수 있음. */
  workspaceId?: string | null;
  entityType?: OutboxEntityType;
  entityId?: string;
  baseVersion?: number;
};

export interface OutboxAdapter {
  put(entry: OutboxEntry): Promise<void>;
  list(limit: number): Promise<OutboxEntry[]>;
  remove(id: string): Promise<void>;
  /** dedupeKey 가 같은 기존 entry 를 새 entry 로 교체 */
  upsertByDedupe(entry: OutboxEntry): Promise<void>;
  clear(): Promise<void>;
}
