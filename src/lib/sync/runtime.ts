import { SyncEngine } from "./engine";
import { realGqlBridge } from "./graphql/bridge";
import { getOutboxAdapter } from "./outbox/adapter";
import type { OutboxOp } from "./outbox/types";
import type { EnqueuePayload } from "./engine";
import { useWorkspaceStore } from "../../store/workspaceStore";

// 런타임 싱글톤. UI/스토어에서 가볍게 enqueue 만 호출하도록 노출.

let _engine: SyncEngine | null = null;
let _enginePromise: Promise<SyncEngine> | null = null;

export async function getSyncEngine(): Promise<SyncEngine> {
  if (_engine) return _engine;
  if (!_enginePromise) {
    _enginePromise = (async () => {
      const outbox = await getOutboxAdapter();
      const engine = new SyncEngine(
        outbox,
        realGqlBridge,
        () => Date.now(),
        () => useWorkspaceStore.getState().currentWorkspaceId ?? null,
      );
      // 콘솔에서 stale outbox 를 즉시 비울 수 있는 디버그 헬퍼.
      // 데스크톱(Tauri SQLite) / 웹(IndexedDB) 모두 같은 한 줄로 동작.
      if (typeof window !== "undefined") {
        const w = window as unknown as Record<string, unknown>;
        w.__QN_clearOutbox = async () => {
          await engine.clearAll();
          return true;
        };
        w.__QN_outboxSnapshot = async () => {
          const snap = await engine.debugSnapshot();
          return snap;
        };
      }
      _engine = engine;
      return engine;
    })().catch((err) => {
      _enginePromise = null;
      throw err;
    });
  }
  return _enginePromise;
}

/**
 * 로그아웃/세션 전환 시 기존 동기화 엔진을 중단한다.
 * 필요하면 outbox 도 함께 비워 이전 계정 pending mutation 재전송을 막는다.
 */
export async function shutdownSyncEngine(
  options?: { clearOutbox?: boolean },
): Promise<void> {
  let engine: SyncEngine | null = _engine;
  if (!engine && _enginePromise) {
    try {
      engine = await _enginePromise;
    } catch {
      engine = null;
    }
  }
  if (engine) {
    engine.stop();
    if (options?.clearOutbox) {
      try {
        await engine.clearAll();
      } catch (err) {
        console.error("[sync] outbox clear on shutdown failed", err);
      }
    }
  }
  _engine = null;
  _enginePromise = null;
}

// fire-and-forget enqueue. 실패 시 콘솔에만 기록.
// payload 는 EnqueuePayload(`{id, updatedAt?}`) 를 만족하면서 추가 필드를 자유롭게 담을 수 있다.
// (전체 GraphQL input 객체를 그대로 넘기는 용도)
export function enqueueAsync(
  op: OutboxOp,
  payload: EnqueuePayload & Record<string, unknown>,
): void {
  void getSyncEngine()
    .then((e) => e.enqueue(op, payload))
    .catch((err) => {
      console.error("[sync] enqueue failed", err);
    });
}
