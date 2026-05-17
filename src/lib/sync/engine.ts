import { ulid } from "./ulid";
import type {
  OutboxAdapter,
  OutboxEntry,
  OutboxOp,
} from "./outbox/types";
import { buildOutboxEntryMeta } from "./outboxMeta";
import { sortOutboxBatchForFlush } from "./outboxFlushOrder";
import { useUiStore } from "../../store/uiStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import { isLCSchedulerDatabaseId } from "../scheduler/database";

// 동기화 엔진. enqueue 시 outbox 에 적재 → 백그라운드 워커가 mutation 으로 flush.
// 같은 (op, id) 의 새 enqueue 는 dedupe 로 마지막 본만 남김.
// 실패한 항목만 지수 백오프 재시도(최대 60초), 나머지 배치는 계속 처리.

export interface GqlBridge {
  upsertPage(input: unknown): Promise<void>;
  upsertDatabase(input: unknown): Promise<void>;
  softDeletePage(id: string, workspaceId: string, updatedAt: string): Promise<void>;
  softDeleteDatabase(id: string, workspaceId: string, updatedAt: string): Promise<void>;
  /** 멤버 본인 clientPrefs(즐겨찾기 등) 동기화. */
  updateMyClientPrefs(clientPrefsJson: string): Promise<void>;
  upsertComment(input: unknown): Promise<void>;
  softDeleteComment(id: string, workspaceId: string, updatedAt: string): Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;
// 영구 실패 entry 를 자동 정리하는 attempts 상한.
// 이 값을 넘긴 entry 는 head 에 영원히 남아 후속 entries 처리를 막는 stuck-head 위험이 있어 outbox 에서 제거한다.
// 빠른 사용자 인지를 위해 15 회로 축소(이전: 50).
const MAX_ATTEMPTS = 15;

export type EnqueuePayload = {
  id: string;
  workspaceId?: string;
  updatedAt?: string;
  /** updateMyClientPrefs 전용(JSON 문자열) */
  clientPrefs?: string;
};

export class SyncEngine {
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly outbox: OutboxAdapter;
  private readonly gql: GqlBridge;
  private readonly clock: () => number;
  /** 플러시 시 UI 워크스페이스와 엔트리 메타 불일치 진단용(옵션). */
  private readonly getCurrentWorkspaceIdForLog?: () => string | null;

  constructor(
    outbox: OutboxAdapter,
    gql: GqlBridge,
    clock: () => number = () => Date.now(),
    getCurrentWorkspaceIdForLog?: () => string | null,
  ) {
    this.outbox = outbox;
    this.gql = gql;
    this.clock = clock;
    this.getCurrentWorkspaceIdForLog = getCurrentWorkspaceIdForLog;
  }

  async enqueue(op: OutboxOp, payload: EnqueuePayload): Promise<void> {
    if (op === "softDeleteDatabase" && isLCSchedulerDatabaseId(payload.id)) {
      return;
    }
    const meta = buildOutboxEntryMeta(
      op,
      payload as Record<string, unknown>,
    );
    const entry: OutboxEntry = {
      id: ulid(),
      op,
      payload,
      enqueuedAt: this.clock(),
      attempts: 0,
      dedupeKey: `${op}:${payload.id}`,
      workspaceId: meta.workspaceId,
      entityType: meta.entityType,
      entityId: meta.entityId,
      baseVersion: meta.baseVersion,
    };
    await this.outbox.upsertByDedupe(entry);
    this.scheduleFlush(0);
  }

  async peekPending(): Promise<number> {
    return (await this.outbox.list(1)).length;
  }

  async debugSnapshot(): Promise<unknown[]> {
    const all = await this.outbox.list(100);
    return all.map((e) => ({
      id: e.id,
      op: e.op,
      attempts: e.attempts,
      pageId: (e.payload as Record<string, unknown>).id,
      workspaceId: (e.payload as Record<string, unknown>).workspaceId,
      entryWorkspaceId: e.workspaceId,
      entityType: e.entityType,
      entityId: e.entityId,
      baseVersion: e.baseVersion,
      docType: typeof (e.payload as Record<string, unknown>).doc,
      enqueuedAt: new Date(e.enqueuedAt).toISOString(),
    }));
  }

  async clearAll(): Promise<void> {
    await this.outbox.clear();
  }

  scheduleFlush(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (true) {
        const batchRaw = await this.outbox.list(20);
        if (batchRaw.length === 0) return;
        const uiWs = this.getCurrentWorkspaceIdForLog?.() ?? null;
        const batch = sortOutboxBatchForFlush(batchRaw, uiWs);

        let minFailBackoff = MAX_BACKOFF_MS;
        let hasFailure = false;

        for (const entry of batch) {
          try {
            this.logWorkspaceMismatchIfAny(entry);
            await this.execute(entry);
            await this.outbox.remove(entry.id);
          } catch (err) {
            // mutation 실패는 운영에서도 유용하므로 GraphQL 메시지 본체를 콘솔에 남긴다.
            const gqlErrors = (err as { errors?: unknown[] }).errors;
            const firstGql = Array.isArray(gqlErrors) ? gqlErrors[0] : null;
            console.error("[sync] mutation failed", entry.op, {
              pageId: (entry.payload as Record<string, unknown>).id,
              attempts: entry.attempts + 1,
              message: (firstGql as { message?: string } | null)?.message
                ?? (err instanceof Error ? err.message : String(err)),
            });
            const attempts = entry.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) {
              // 영구 실패로 간주하고 dead-letter 처리.
              // 이 entry 가 head 에 남아있으면 후속 enqueue 가 영원히 처리되지 못한다.
              console.warn(
                "[sync] dropping entry after max attempts",
                entry.op,
                entry.payload,
              );
              await this.outbox.putDeadLetter?.(
                {
                  ...entry,
                  attempts,
                  lastErrorAt: this.clock(),
                },
                "max-attempts-exceeded",
              );
              await this.outbox.remove(entry.id);
              // 사용자에게 저장 실패 알림
              useUiStore.getState().showToast(
                "데이터 일부가 저장되지 못했습니다. 네트워크 상태를 확인해 주세요.",
                { kind: "error" },
              );
              continue;
            }
            const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.attempts);
            await this.outbox.put({
              ...entry,
              attempts,
              lastErrorAt: this.clock(),
            });
            // 실패한 항목은 기록만 하고 나머지 배치는 계속 처리
            hasFailure = true;
            minFailBackoff = Math.min(minFailBackoff, backoff);
          }
        }

        // 배치 내 실패 항목이 있으면 최소 백오프로 재시도 예약 후 종료
        if (hasFailure) {
          this.scheduleFlush(minFailBackoff);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** UI가 다른 워크스페이스에 있어도 payload 기준 전송은 해야 하므로, 경고만 남긴다. */
  private logWorkspaceMismatchIfAny(entry: OutboxEntry): void {
    if (entry.op === "updateMyClientPrefs") return;
    const fn = this.getCurrentWorkspaceIdForLog;
    if (!fn) return;
    const uiWs = fn();
    const entryWs = entry.workspaceId;
    if (!uiWs || entryWs == null || entryWs === "") return;
    if (entryWs === LC_SCHEDULER_WORKSPACE_ID) return;
    if (entryWs !== uiWs) {
      console.warn(
        "[sync] outbox flush: UI 워크스페이스와 엔트리 메타 workspaceId 불일치 (payload 기준으로 전송 진행)",
        {
          op: entry.op,
          entryWorkspaceId: entryWs,
          uiWorkspaceId: uiWs,
          entityId: entry.entityId,
        },
      );
    }
  }

  private async execute(entry: OutboxEntry): Promise<void> {
    const p = entry.payload as EnqueuePayload;
    switch (entry.op) {
      case "upsertPage":
        return this.gql.upsertPage(p);
      case "upsertDatabase":
        return this.gql.upsertDatabase(p);
      case "softDeletePage":
        return this.gql.softDeletePage(p.id, p.workspaceId ?? "", p.updatedAt ?? "");
      case "softDeleteDatabase":
        if (isLCSchedulerDatabaseId(p.id)) return;
        return this.gql.softDeleteDatabase(p.id, p.workspaceId ?? "", p.updatedAt ?? "");
      case "upsertComment":
        return this.gql.upsertComment(p);
      case "softDeleteComment":
        return this.gql.softDeleteComment(p.id, p.workspaceId ?? "", p.updatedAt ?? "");
      case "updateMyClientPrefs": {
        const json = (p as { clientPrefs?: string }).clientPrefs;
        if (typeof json !== "string" || !json) {
          throw new Error("updateMyClientPrefs: clientPrefs 문자열 누락");
        }
        return this.gql.updateMyClientPrefs(json);
      }
    }
  }
}
