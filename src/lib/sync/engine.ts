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
import { ensureFreshTokensForAppSync } from "../auth/apiTokens";
import { markPermanentlyDeletedEntity } from "./localDeleteGuards";

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

function normalizeClientPrefsJsonForServer(json: string): string {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (Number(parsed.v) === 2) {
      return JSON.stringify({ ...parsed, v: 1 });
    }
  } catch {
    return json;
  }
  return json;
}

const MAX_BACKOFF_MS = 60_000;
const DEAD_LETTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// 영구 실패 entry 를 자동 정리하는 attempts 상한.
// 이 값을 넘긴 entry 는 head 에 영원히 남아 후속 entries 처리를 막는 stuck-head 위험이 있어 outbox 에서 제거한다.
// 빠른 사용자 인지를 위해 15 회로 축소(이전: 50).
const MAX_ATTEMPTS = 15;
const AUTH_RETRY_DELAY_MS = 5_000;
const TRANSIENT_RETRY_DELAY_MS = 4_000;
const TRANSIENT_LOG_THROTTLE_MS = 15_000;

function getErrorMessage(error: unknown): string {
  // Amplify v6 GraphQL error 객체는 다음 중 하나의 형태를 띌 수 있다:
  // 1) { errors: [{ message, errorType, errorInfo }], data: null }
  // 2) GraphQLError { message, extensions: { ... } }
  // 3) plain Error
  // 4) { networkError: { ... } } / { graphQLErrors: [...] }
  // 가능한 모든 경로에서 message 를 추출하고, 끝까지 못 찾으면 전체 JSON 을 직렬화한다.
  const parts: string[] = [];
  const visit = (val: unknown, depth: number): void => {
    if (depth > 4 || val == null) return;
    if (typeof val === "string") {
      if (val) parts.push(val);
      return;
    }
    if (val instanceof Error) {
      if (val.message) parts.push(val.message);
      // AggregateError / cause 체인
      const cause = (val as { cause?: unknown }).cause;
      if (cause) visit(cause, depth + 1);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) visit(item, depth + 1);
      return;
    }
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
      if (typeof obj.errorType === "string" && obj.errorType) parts.push(obj.errorType);
      if (typeof obj.errorInfo === "string" && obj.errorInfo) parts.push(obj.errorInfo);
      if (obj.errors) visit(obj.errors, depth + 1);
      if (obj.graphQLErrors) visit(obj.graphQLErrors, depth + 1);
      if (obj.networkError) visit(obj.networkError, depth + 1);
      if (obj.cause) visit(obj.cause, depth + 1);
      if (obj.extensions) visit(obj.extensions, depth + 1);
    }
  };
  visit(error, 0);
  if (parts.length > 0) return parts.join(" | ");
  // 최후 fallback: JSON 직렬화. 한국어 메시지가 raw 객체 어딘가에 있을 수 있어 검사 가능.
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}

function isUnauthorizedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("unauthorized")
    || m.includes("not authorized")
    || m.includes("no valid auth token")
    || m.includes("401")
  );
}

function isPayloadTooLargeError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("item size has exceeded the maximum allowed size") ||
    m.includes("maximum allowed size") ||
    m.includes("payload too large")
  );
}

function isTransientNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("timed_out")
    || m.includes("timeout")
    || m.includes("failed to fetch")
    || m.includes("networkerror")
    || m.includes("network request failed")
  );
}

function isResourceGoneError(message: string): boolean {
  const m = message.normalize("NFKC").toLowerCase();
  return (
    m.includes("리소스 없음")
    || (m.includes("리소스") && m.includes("없"))
    || m.includes("resource not found")
    || m.includes("no resource")
    || m.includes("not found")
  );
}

function isDeleteOp(op: OutboxOp): boolean {
  return op === "softDeletePage" || op === "softDeleteDatabase" || op === "softDeleteComment";
}

/** delete op entry 가 서버에서 영구히 사라진 것으로 확정될 때 호출. localDeleteGuards 를 영구 tombstone 으로 승격. */
function promoteDeleteEntryToPermanentTombstone(entry: OutboxEntry): void {
  const payload = entry.payload as { id?: string; workspaceId?: string };
  const id = payload?.id;
  const workspaceId = payload?.workspaceId ?? entry.workspaceId;
  if (!id || !workspaceId) return;
  if (entry.op === "softDeletePage") {
    markPermanentlyDeletedEntity("page", id, workspaceId);
  } else if (entry.op === "softDeleteDatabase") {
    markPermanentlyDeletedEntity("database", id, workspaceId);
  }
  // comment 는 별도 가드 시스템이 없으므로 처리하지 않음.
}

function supersededUpsertOpForDelete(op: OutboxOp): OutboxOp | null {
  switch (op) {
    case "softDeletePage":
      return "upsertPage";
    case "softDeleteDatabase":
      return "upsertDatabase";
    case "softDeleteComment":
      return "upsertComment";
    default:
      return null;
  }
}

function supersededUpsertDedupeKeyForDelete(entry: OutboxEntry): string | null {
  const upsertOp = supersededUpsertOpForDelete(entry.op);
  if (!upsertOp || !entry.entityId) return null;
  return `${upsertOp}:${entry.entityId}`;
}

function supersededUpsertDedupeKeysForDeleteBatch(batch: OutboxEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of batch) {
    const key = supersededUpsertDedupeKeyForDelete(entry);
    if (key) keys.add(key);
  }
  return keys;
}

function isWorkspaceMismatchDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("quicknote.debug.syncWorkspaceMismatch") === "1";
  } catch {
    return false;
  }
}

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
  private stopped = false;
  private readonly outbox: OutboxAdapter;
  private readonly gql: GqlBridge;
  private readonly clock: () => number;
  private enqueueTail: Promise<void> = Promise.resolve();
  private lastTransientLogAt = 0;
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
    if (this.stopped) return;
    const task = this.enqueueTail.then(() => this.enqueueNow(op, payload));
    this.enqueueTail = task.catch(() => undefined);
    return task;
  }

  private async enqueueNow(op: OutboxOp, payload: EnqueuePayload): Promise<void> {
    if (this.stopped) return;
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
    await this.removeSupersededUpsertForDelete(entry);
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
      payloadKeys: Object.keys(e.payload as Record<string, unknown>).sort(),
      templatesType: typeof (e.payload as Record<string, unknown>).templates,
      docType: typeof (e.payload as Record<string, unknown>).doc,
      enqueuedAt: new Date(e.enqueuedAt).toISOString(),
    }));
  }

  /**
   * set-reconciliation 시 보호해야 할 pending upsert entity id 집합을 반환.
   * (서버 응답에 없어도 outbox 가 아직 업로드 중이면 로컬에서 지우면 안 됨)
   */
  async getPendingUpsertEntityIds(): Promise<{
    pages: Set<string>;
    databases: Set<string>;
  }> {
    const pages = new Set<string>();
    const databases = new Set<string>();
    const all = await this.outbox.list(5000);
    for (const e of all) {
      const payloadId = (e.payload as { id?: string })?.id;
      if (!payloadId) continue;
      if (e.op === "upsertPage") pages.add(payloadId);
      else if (e.op === "upsertDatabase") databases.add(payloadId);
    }
    return { pages, databases };
  }

  async clearAll(): Promise<void> {
    await this.outbox.clear();
  }

  /**
   * 주어진 페이지 id 들에 대한 모든 pending outbox entry(upsertPage/softDeletePage)를 제거.
   * 휴지통 영구삭제 직후 호출 — 잔여 upsert 가 flush 되어 서버 row 를 재생성(되살아남)하는 것을 차단한다.
   */
  async purgePendingForPageIds(ids: ReadonlySet<string>): Promise<void> {
    if (ids.size === 0) return;
    const all = await this.outbox.list(5000);
    for (const e of all) {
      if (e.op !== "upsertPage" && e.op !== "softDeletePage") continue;
      const pid = (e.payload as { id?: string })?.id;
      if (pid && ids.has(pid)) {
        await this.outbox.remove(e.id);
      }
    }
  }

  scheduleFlush(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async clearDeadLetters(): Promise<void> {
    await this.outbox.clearDeadLetters?.();
  }

  async getDeadLetterCount(): Promise<number> {
    const items = await this.outbox.listDeadLetters?.(1000);
    return items?.length ?? 0;
  }

  async listDeadLetters(): Promise<Array<import("./outbox/types").OutboxEntry & { deadLetterReason: string }>> {
    return (await this.outbox.listDeadLetters?.(200)) ?? [];
  }

  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.outbox.pruneExpiredDeadLetters?.(DEAD_LETTER_TTL_MS);
      while (true) {
        if (this.stopped) return;
        const batchRaw = await this.outbox.list(20);
        if (batchRaw.length === 0) return;
        const uiWs = this.getCurrentWorkspaceIdForLog?.() ?? null;
        const batch = sortOutboxBatchForFlush(batchRaw, uiWs);
        const supersededUpsertKeys = supersededUpsertDedupeKeysForDeleteBatch(batch);

        let minFailBackoff = MAX_BACKOFF_MS;
        let hasFailure = false;

        for (const entry of batch) {
          if (this.stopped) return;
          if (supersededUpsertKeys.has(entry.dedupeKey)) {
            await this.outbox.remove(entry.id);
            continue;
          }
          try {
            this.logWorkspaceMismatchIfAny(entry);
            await this.removeSupersededUpsertForDelete(entry);
            await this.execute(entry);
            await this.outbox.remove(entry.id);
          } catch (err) {
            if (this.stopped) return;
            const message = getErrorMessage(err);
            const now = this.clock();
            if (isDeleteOp(entry.op) && isResourceGoneError(message)) {
              await this.outbox.putDeadLetter?.(
                {
                  ...entry,
                  attempts: entry.attempts + 1,
                  lastErrorAt: now,
                },
                "resource-already-gone",
              );
              await this.outbox.remove(entry.id);
              // 서버에서도 row 가 사라진 것이 확정 → 영구 tombstone 으로 승격.
              // Bootstrap re-fetch / 구독 이벤트가 다시 들여올 가능성을 원천 차단.
              promoteDeleteEntryToPermanentTombstone(entry);
              continue;
            }
            const shouldLogTransient = now - this.lastTransientLogAt >= TRANSIENT_LOG_THROTTLE_MS;
            const isAuthError = isUnauthorizedError(message);
            const isTransientError = isTransientNetworkError(message);
            if (!isTransientError || shouldLogTransient) {
              if (isTransientError) this.lastTransientLogAt = now;
              console.error("[sync] mutation failed", entry.op, {
                pageId: (entry.payload as Record<string, unknown>).id,
                attempts: entry.attempts + 1,
                message,
              });
            }
            if (isAuthError) {
              try {
                await ensureFreshTokensForAppSync();
              } catch {
                // no-op: 토큰 갱신 실패 시 기존 세션으로 백오프 재시도
              }
              await this.outbox.put({
                ...entry,
                lastErrorAt: now,
              });
              hasFailure = true;
              minFailBackoff = Math.min(minFailBackoff, AUTH_RETRY_DELAY_MS);
              continue;
            }
            if (isTransientError) {
              await this.outbox.put({
                ...entry,
                lastErrorAt: now,
              });
              hasFailure = true;
              minFailBackoff = Math.min(minFailBackoff, TRANSIENT_RETRY_DELAY_MS);
              continue;
            }
            if (isPayloadTooLargeError(message)) {
              console.warn(
                "[sync] dropping oversize payload entry",
                entry.op,
                entry.payload,
              );
              await this.outbox.putDeadLetter?.(
                {
                  ...entry,
                  attempts: entry.attempts + 1,
                  lastErrorAt: now,
                },
                "payload-too-large",
              );
              await this.outbox.remove(entry.id);
              useUiStore.getState().showToast(
                "페이지 크기가 너무 커서 서버에 저장하지 못했습니다. 본문을 분리해 주세요.",
                { kind: "error" },
              );
              continue;
            }
            const attempts = entry.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) {
              // 영구 실패로 간주하고 dead-letter 처리.
              // 이 entry 가 head 에 남아있으면 후속 enqueue 가 영원히 처리되지 못한다.
              const isDeadResource = isDeleteOp(entry.op) && isResourceGoneError(message);
              console.warn(
                "[sync] dropping entry after max attempts",
                entry.op,
                entry.payload,
              );
              await this.outbox.putDeadLetter?.(
                {
                  ...entry,
                  attempts,
                  lastErrorAt: now,
                },
                isDeadResource ? "resource-already-gone" : "max-attempts-exceeded",
              );
              await this.outbox.remove(entry.id);
              if (isDeadResource) {
                // 마지막 시도에서 resource-gone 확인 → 영구 tombstone 으로 승격.
                promoteDeleteEntryToPermanentTombstone(entry);
              } else {
                // 사용자에게 저장 실패 알림 (resource-gone 은 정상 완료이므로 토스트 생략).
                useUiStore.getState().showToast(
                  "데이터 일부가 저장되지 못했습니다. 네트워크 상태를 확인해 주세요.",
                  { kind: "error" },
                );
              }
              continue;
            }
            const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.attempts);
            await this.outbox.put({
              ...entry,
              attempts,
              lastErrorAt: now,
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

  /** UI가 다른 워크스페이스에 있어도 payload 기준 전송은 정상 동작이다. 필요할 때만 디버그 로그를 켠다. */
  private logWorkspaceMismatchIfAny(entry: OutboxEntry): void {
    if (!isWorkspaceMismatchDebugEnabled()) return;
    if (entry.op === "updateMyClientPrefs") return;
    const fn = this.getCurrentWorkspaceIdForLog;
    if (!fn) return;
    const uiWs = fn();
    const entryWs = entry.workspaceId;
    if (!uiWs || entryWs == null || entryWs === "") return;
    if (entryWs === LC_SCHEDULER_WORKSPACE_ID) return;
    if (entryWs !== uiWs) {
      console.debug(
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
        if ("templates" in (p as Record<string, unknown>)) {
          console.warn("[QN_TEMPLATE_SYNC] outboxFlush upsertDatabase", {
            databaseId: p.id,
            workspaceId: p.workspaceId ?? null,
            updatedAt: p.updatedAt ?? null,
            templatesType: typeof (p as Record<string, unknown>).templates,
          });
        }
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
        return this.gql.updateMyClientPrefs(normalizeClientPrefsJsonForServer(json));
      }
    }
  }

  private async removeSupersededUpsertForDelete(entry: OutboxEntry): Promise<void> {
    if (!isDeleteOp(entry.op)) return;
    const targetDedupeKey = supersededUpsertDedupeKeyForDelete(entry);
    if (!targetDedupeKey) return;
    const batch = await this.outbox.list(5000);
    for (const pending of batch) {
      if (pending.dedupeKey !== targetDedupeKey) continue;
      await this.outbox.remove(pending.id);
    }
  }
}
