import { SyncEngine } from "./engine";
import { realGqlBridge } from "./graphql/bridge";
import { getOutboxAdapter } from "./outbox/adapter";
import type { OutboxOp } from "./outbox/types";
import type { EnqueuePayload } from "./engine";

// 런타임 싱글톤. UI/스토어에서 가볍게 enqueue 만 호출하도록 노출.

let _engine: SyncEngine | null = null;

export async function getSyncEngine(): Promise<SyncEngine> {
  if (!_engine) {
    const outbox = await getOutboxAdapter();
    _engine = new SyncEngine(outbox, realGqlBridge);
  }
  return _engine;
}

// fire-and-forget enqueue. 실패 시 콘솔에만 기록.
export function enqueueAsync(op: OutboxOp, payload: EnqueuePayload): void {
  void getSyncEngine()
    .then((e) => e.enqueue(op, payload))
    .catch((err) => {
      console.error("[sync] enqueue failed", err);
    });
}
