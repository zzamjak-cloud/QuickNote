// 페이지 1개(room)에 대한 Yjs WebSocket provider.
// 서버 프로토콜(infra/lambda/realtime): hello{sv} → sync{update,sv} → sv-reply{update} → update{update}.
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  serializeClientMessage,
  parseServerMessage,
} from "./wsProtocol";

type ProviderEvent = "synced" | "status";
type StatusValue = "connecting" | "connected" | "disconnected";

export type QnWsProviderOptions = {
  doc: Y.Doc;
  url: string;
  /** 테스트용 소켓 주입. 미지정 시 전역 WebSocket 사용. */
  socketFactory?: (url: string) => WebSocket;
  /** keepalive ping 간격(ms). 기본 25초(API GW idle 10분 대비 충분). */
  pingIntervalMs?: number;
  /** 최대 재연결 backoff(ms). */
  maxBackoffMs?: number;
  /** 프레즌스용 awareness(없으면 Phase 1 동작 그대로). */
  awareness?: Awareness;
};

// 수신 update 적용 시 사용하는 origin — 로컬 echo 전송 방지에 사용.
const REMOTE_ORIGIN = Symbol("qn-ws-remote");

export class QnWsProvider {
  private doc: Y.Doc;
  private url: string;
  private socketFactory: (url: string) => WebSocket;
  private pingIntervalMs: number;
  private maxBackoffMs: number;

  private awareness: Awareness | null;

  private ws: WebSocket | null = null;
  private destroyed = false;
  private synced = false;
  private retries = 0;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private listeners: Record<ProviderEvent, Set<(arg?: unknown) => void>> = {
    synced: new Set(),
    status: new Set(),
  };

  constructor(opts: QnWsProviderOptions) {
    this.doc = opts.doc;
    this.url = opts.url;
    this.socketFactory =
      opts.socketFactory ?? ((u: string) => new WebSocket(u));
    this.pingIntervalMs = opts.pingIntervalMs ?? 25_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15_000;
    this.doc.on("update", this.handleLocalUpdate);
    this.awareness = opts.awareness ?? null;
    if (this.awareness) {
      this.awareness.on("update", this.handleAwarenessUpdate);
      // 탭 강제 닫기 시 destroy() 가 안 불릴 수 있으므로 beforeunload 로 self 제거를 보장한다.
      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", this.handleBeforeUnload);
      }
    }
  }

  on(event: ProviderEvent, cb: (arg?: unknown) => void): void {
    this.listeners[event].add(cb);
  }
  off(event: ProviderEvent, cb: (arg?: unknown) => void): void {
    this.listeners[event].delete(cb);
  }
  private emit(event: ProviderEvent, arg?: unknown): void {
    for (const cb of this.listeners[event]) cb(arg);
  }

  get isSynced(): boolean {
    return this.synced;
  }

  connect(): void {
    if (this.destroyed) return;
    this.emit("status", "connecting" as StatusValue);
    const ws = this.socketFactory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.emit("status", "connected" as StatusValue);
      this.send(serializeClientMessage({ t: "hello", sv: Y.encodeStateVector(this.doc) }));
      this.startPing();
      // 새/재연결 시 로컬 awareness 를 즉시 피어에 알린다.
      if (this.awareness) {
        const u = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
        this.send(serializeClientMessage({ t: "awareness", update: u }));
      }
    };
    ws.onmessage = (e: MessageEvent) => this.handleMessage(String(e.data));
    ws.onclose = () => this.handleClose();
    ws.onerror = () => {
      // onclose 가 이어서 호출되므로 여기서는 재연결을 트리거하지 않는다.
    };
  }

  private send(data: string): void {
    const ws = this.ws;
    if (!ws) return;
    const OPEN = (ws.constructor as { OPEN?: number }).OPEN ?? 1;
    if (ws.readyState !== OPEN) return;
    ws.send(data);
  }

  private handleMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    if (msg.t === "sync") {
      Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
      const diff = Y.encodeStateAsUpdate(this.doc, msg.sv);
      this.send(serializeClientMessage({ t: "sv-reply", update: diff }));
      if (!this.synced) {
        this.synced = true;
        this.emit("synced");
      }
      return;
    }
    if (msg.t === "update") {
      Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
      return;
    }
    if (msg.t === "awareness") {
      if (this.awareness) applyAwarenessUpdate(this.awareness, msg.update, REMOTE_ORIGIN);
      return;
    }
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed) return;
    if (origin === REMOTE_ORIGIN) return;
    this.send(serializeClientMessage({ t: "update", update }));
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (this.destroyed) return;
    if (origin === REMOTE_ORIGIN) return; // 원격 적용분 echo 방지
    if (!this.awareness) return;
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    const u = encodeAwarenessUpdate(this.awareness, changed);
    this.send(serializeClientMessage({ t: "awareness", update: u }));
  };

  // 탭 닫기/새로고침 직전 — self awareness 제거(handleAwarenessUpdate 가 동기 전송).
  private handleBeforeUnload = (): void => {
    if (this.awareness) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "window-unload");
    }
  };

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send(serializeClientMessage({ t: "hello", sv: Y.encodeStateVector(this.doc) }));
    }, this.pingIntervalMs);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleClose(): void {
    this.stopPing();
    this.ws = null;
    this.synced = false;
    this.emit("status", "disconnected" as StatusValue);
    if (this.destroyed) return;
    const delay = Math.min(this.maxBackoffMs, 500 * 2 ** this.retries);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  destroy(): void {
    // 정상 이탈: self awareness 제거를 피어에 알린다(handleAwarenessUpdate 가 전송).
    if (this.awareness) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
      this.awareness.off("update", this.handleAwarenessUpdate);
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", this.handleBeforeUnload);
      }
    }
    this.destroyed = true;
    this.doc.off("update", this.handleLocalUpdate);
    this.stopPing();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* 무시 */
      }
      this.ws = null;
    }
  }
}
