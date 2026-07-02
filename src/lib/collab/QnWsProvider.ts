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
  splitMessage,
  parseChunk,
  newMsgId,
  type ClientMessage,
  type ChunkMsg,
} from "./wsProtocol";

type ProviderEvent = "synced" | "status";
type StatusValue = "connecting" | "connected" | "disconnected" | "offline";

export type QnWsProviderOptions = {
  doc: Y.Doc;
  url: string;
  /** 테스트용 소켓 주입. 미지정 시 전역 WebSocket 사용. */
  socketFactory?: (url: string) => WebSocket;
  /** keepalive ping 간격(ms). 기본 4분(API GW idle 10분 대비 충분). */
  pingIntervalMs?: number;
  /** 최대 재연결 backoff(ms). */
  maxBackoffMs?: number;
  /** 연속 재연결 시도 최대 횟수(초과 시 중단). 기본 3. 0 이면 재연결 안 함. */
  maxReconnectAttempts?: number;
  /** 프레즌스용 awareness(없으면 Phase 1 동작 그대로). */
  awareness?: Awareness;
};

// 수신 update 적용 시 사용하는 origin — 로컬 echo 전송 방지 + 로컬 편집 판별(useCollabSession)에 사용.
export const QN_WS_REMOTE_ORIGIN = Symbol("qn-ws-remote");
const REMOTE_ORIGIN = QN_WS_REMOTE_ORIGIN;

export class QnWsProvider {
  private doc: Y.Doc;
  private url: string;
  private socketFactory: (url: string) => WebSocket;
  private pingIntervalMs: number;
  private maxBackoffMs: number;
  private maxReconnectAttempts: number;

  private awareness: Awareness | null;

  private ws: WebSocket | null = null;
  private destroyed = false;
  private synced = false;
  private retries = 0;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private offline = false;
  private listeners: Record<ProviderEvent, Set<(arg?: unknown) => void>> = {
    synced: new Set(),
    status: new Set(),
  };

  constructor(opts: QnWsProviderOptions) {
    this.doc = opts.doc;
    this.url = opts.url;
    this.socketFactory =
      opts.socketFactory ?? ((u: string) => new WebSocket(u));
    this.pingIntervalMs = opts.pingIntervalMs ?? 240_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15_000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 3;
    this.doc.on("update", this.handleLocalUpdate);
    this.awareness = opts.awareness ?? null;
    if (this.awareness) {
      this.awareness.on("update", this.handleAwarenessUpdate);
      // 탭 강제 닫기 시 destroy() 가 안 불릴 수 있으므로 beforeunload 로 self 제거를 보장한다.
      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", this.handleBeforeUnload);
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.offline = true;
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
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
    if (this.destroyed || this.offline) return;
    this.emit("status", "connecting" as StatusValue);
    const ws = this.socketFactory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.emit("status", "connected" as StatusValue);
      this.sendMsg({ t: "hello", sv: Y.encodeStateVector(this.doc) });
      this.startPing();
      // 새/재연결 시 로컬 awareness 를 즉시 피어에 알린다.
      if (this.awareness) {
        const u = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
        this.sendMsg({ t: "awareness", update: u });
      }
    };
    ws.onmessage = (e: MessageEvent) => this.handleMessage(String(e.data));
    ws.onclose = () => this.handleClose();
    ws.onerror = () => {
      // onclose 가 이어서 호출되므로 여기서는 재연결을 트리거하지 않는다.
    };
  }

  // ClientMessage 를 직렬화해 전송. 28KB 초과 메시지는 chunk 로 분할한다.
  private sendMsg(msg: ClientMessage): void {
    const serialized = serializeClientMessage(msg);
    for (const f of splitMessage(serialized, newMsgId())) this.sendRaw(f);
  }

  private sendRaw(data: string): void {
    const ws = this.ws;
    if (!ws) return;
    const OPEN = (ws.constructor as { OPEN?: number }).OPEN ?? 1;
    if (ws.readyState !== OPEN) return;
    ws.send(data);
  }

  private detachSocket(ws: WebSocket | null = this.ws): void {
    if (!ws) return;
    if (this.ws === ws) this.ws = null;

    const ctor = ws.constructor as { CONNECTING?: number; OPEN?: number };
    const CONNECTING = ctor.CONNECTING ?? 0;
    const OPEN = ctor.OPEN ?? 1;

    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;

    if (ws.readyState === OPEN) {
      try {
        ws.close();
      } catch {
        /* 무시 */
      }
      return;
    }

    if (ws.readyState === CONNECTING) {
      // WebKit은 CONNECTING 소켓을 즉시 close() 하면 콘솔 에러를 남긴다.
      ws.onopen = () => {
        try {
          ws.close();
        } catch {
          /* 무시 */
        }
      };
      return;
    }

    ws.onopen = null;
  }

  // 수신 chunk 재조립 버퍼(msgId → 도착한 body 조각들).
  private chunkBuf = new Map<string, { parts: string[]; n: number; got: number }>();

  // chunk 메시지를 누적하고, 모두 도착하면 원본 직렬화 문자열을 반환한다(아니면 null).
  private collectChunk(c: ChunkMsg): string | null {
    let entry = this.chunkBuf.get(c.id);
    if (!entry) {
      entry = { parts: new Array<string>(c.n), n: c.n, got: 0 };
      this.chunkBuf.set(c.id, entry);
    }
    if (entry.parts[c.i] === undefined) entry.got += 1;
    entry.parts[c.i] = c.body;
    if (entry.got < entry.n) return null;
    this.chunkBuf.delete(c.id);
    return entry.parts.join("");
  }

  private handleMessage(raw: string): void {
    const c = parseChunk(raw);
    if (c) {
      const assembled = this.collectChunk(c);
      if (assembled) this.dispatchServer(assembled);
      return;
    }
    this.dispatchServer(raw);
  }

  private dispatchServer(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    if (msg.t === "sync") {
      Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
      // sv-reply(서버가 모르는 로컬 delta 업로드)는 연결당 첫 sync 에서만 보낸다.
      // 첫 sync 이후의 편집은 doc update → "update" 메시지로 전송되므로 매번 보낼 필요가 없다.
      // hello 재동기화(탭 전면 복귀 등)의 sync 응답마다 보내면 stale IDB 잔재가 서버 룸에 반복
      // append 되어 권위 본문을 옛 내용으로 오염시킨다(H3). 재연결 시 synced=false 로 리셋되므로,
      // 끊긴 동안의 편집분은 다음 첫 sync 의 sv-reply 로 정상 업로드된다(오프라인 편집 복구 유지).
      if (!this.synced) {
        const diff = Y.encodeStateAsUpdate(this.doc, msg.sv);
        this.sendMsg({ t: "sv-reply", update: diff });
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

  // 로컬 update 송신 배칭 — 타이핑은 키 입력마다 Y update 가 발생하고, 메시지마다 서버
  // Lambda 호출 + DDB append + 룸 fan-out 비용이 든다. 첫 변경은 즉시 보내고(leading edge)
  // 쿨다운 동안의 변경은 Y.mergeUpdates 로 병합해 만료 시점에 한 메시지로 보낸다.
  // 연결이 끊기면 버퍼는 폐기한다 — 재연결 첫 sync 의 sv-reply(doc 전체 diff)가 복구한다.
  private static readonly UPDATE_BATCH_MS = 250;
  private updateBuf: Uint8Array[] = [];
  private updateFlushTimer: number | null = null;

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed) return;
    if (origin === REMOTE_ORIGIN) return;
    this.updateBuf.push(update);
    if (this.updateFlushTimer !== null) return; // 쿨다운 중 — 만료 시 병합 전송
    this.flushPendingUpdates();
    this.updateFlushTimer = window.setTimeout(() => {
      this.updateFlushTimer = null;
      this.flushPendingUpdates();
    }, QnWsProvider.UPDATE_BATCH_MS);
  };

  // 버퍼된 로컬 update 를 병합해 한 메시지로 전송한다.
  private flushPendingUpdates(): void {
    if (this.updateBuf.length === 0) return;
    const merged =
      this.updateBuf.length === 1 ? this.updateBuf[0]! : Y.mergeUpdates(this.updateBuf);
    this.updateBuf = [];
    this.sendMsg({ t: "update", update: merged });
  }

  // 배칭 버퍼·타이머를 폐기한다(연결 단절 시 — sv-reply 복구 경로가 있어 안전).
  private discardPendingUpdates(): void {
    if (this.updateFlushTimer !== null) {
      window.clearTimeout(this.updateFlushTimer);
      this.updateFlushTimer = null;
    }
    this.updateBuf = [];
  }

  // awareness 송신 스로틀 — 커서 이동은 이벤트가 초당 수 회 발생하고, 메시지마다 서버
  // Lambda 호출 + 룸 fan-out 비용이 든다. 첫 변경은 즉시 보내고(leading edge, 체감 지연 없음)
  // 쿨다운 동안의 변경은 client id 를 모아 만료 시점에 일괄 전송한다.
  private static readonly AWARENESS_THROTTLE_MS = 300;
  private awarenessPending = new Set<number>();
  private awarenessSendTimer: number | null = null;

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (this.destroyed) return;
    if (origin === REMOTE_ORIGIN) return; // 원격 적용분 echo 방지
    if (!this.awareness) return;
    for (const id of [...changes.added, ...changes.updated, ...changes.removed]) {
      this.awarenessPending.add(id);
    }
    // 이탈(removed)은 즉시 전송 — 탭 종료 직전에는 트레일링 타이머가 실행될 기회가 없다.
    if (changes.removed.length > 0) {
      this.flushAwarenessPending();
      return;
    }
    if (this.awarenessSendTimer !== null) return; // 쿨다운 중 — 만료 시 일괄 전송
    this.flushAwarenessPending();
    this.awarenessSendTimer = window.setTimeout(() => {
      this.awarenessSendTimer = null;
      this.flushAwarenessPending();
    }, QnWsProvider.AWARENESS_THROTTLE_MS);
  };

  // 누적된 awareness 변경(client id)을 한 메시지로 전송한다.
  private flushAwarenessPending(): void {
    if (!this.awareness || this.awarenessPending.size === 0) return;
    const changed = [...this.awarenessPending];
    this.awarenessPending.clear();
    const u = encodeAwarenessUpdate(this.awareness, changed);
    this.sendMsg({ t: "awareness", update: u });
  }

  // 탭 닫기/새로고침 직전 — 배칭 중인 편집분을 먼저 밀어내고 self awareness 를 제거한다
  // (handleAwarenessUpdate 가 동기 전송).
  private handleBeforeUnload = (): void => {
    this.flushPendingUpdates();
    if (this.awareness) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "window-unload");
    }
  };

  // 네트워크 오프라인 — 재연결 타이머·소켓을 정리하고 offline status 를 emit 한다.
  private handleOffline = (): void => {
    this.offline = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.discardPendingUpdates(); // 온라인 복귀 후 첫 sync 의 sv-reply 가 복구
    this.emit("status", "offline" as StatusValue);
    this.synced = false;
    this.chunkBuf.clear();
    this.detachSocket();
  };

  // 탭 전면 복귀 — 백그라운드 동안 놓친 update 를 hello 재동기화로 보정한다.
  // synced=true 상태의 sync 응답은 sv-reply 를 다시 보내지 않으므로(H3 가드) 안전하다.
  private handleVisibilityChange = (): void => {
    if (this.destroyed || this.offline) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    this.sendMsg({ t: "hello", sv: Y.encodeStateVector(this.doc) });
  };

  // 네트워크 온라인 복귀 — backoff 대기 없이 즉시 재연결한다.
  private handleOnline = (): void => {
    if (this.destroyed) return;
    // offline 상태였을 때만 즉시 재연결. 그 외(이미 온라인·정상 disconnect 의 backoff 대기 중)에
    // spurious online 이벤트로 connect() 를 또 부르면 기존 소켓을 닫지 않은 채 중복 연결이 생긴다.
    if (!this.offline) return;
    this.offline = false;
    this.retries = 0;
    this.connect();
  };

  private startPing(): void {
    this.stopPing();
    // keepalive 는 경량 ping 으로만 보낸다. hello 는 서버가 룸 전체 상태를 로드해 diff 를
    // 응답하므로(Lambda+DynamoDB 비용) 주기 전송에 쓰지 않는다 — 놓친 update 보정은
    // 재연결 시 hello + 탭 전면 복귀 시 hello(handleVisibilityChange)가 담당한다.
    this.pingTimer = window.setInterval(() => {
      this.sendMsg({ t: "ping" });
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
    // 끊긴 동안의 배칭 버퍼는 폐기 — 재연결 첫 sync 의 sv-reply 가 doc 전체 diff 로 복구한다.
    this.discardPendingUpdates();
    this.ws = null;
    this.synced = false;
    // 끊긴 연결의 미완성 chunk 는 버린다(재연결 시 처음부터 다시 받음).
    this.chunkBuf.clear();
    if (this.offline) return; // offline 상태는 handleOffline 이 status 를 관리 — 덮어쓰지 않음
    this.emit("status", "disconnected" as StatusValue);
    if (this.destroyed) return;
    // 무한 재연결 방지: 연속 실패가 한도(기본 3회)에 도달하면 재연결을 중단한다.
    // (깨진/없는 룸 등 영구 실패 시 1초 주기 무한 루프·콘솔 스팸을 막음. 콘솔 에러 자체는 허용.)
    // 네트워크 복귀(handleOnline)나 페이지 재진입(새 provider)에서는 retries 가 리셋돼 다시 시도한다.
    if (this.retries >= this.maxReconnectAttempts) return;
    const delay = Math.min(this.maxBackoffMs, 500 * 2 ** this.retries);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  destroy(): void {
    // 페이지 이탈 등 정상 종료: 배칭 중인 편집분을 먼저 밀어낸다.
    this.flushPendingUpdates();
    // 정상 이탈: self awareness 제거를 피어에 알린다(handleAwarenessUpdate 가 전송).
    if (this.awareness) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
      this.awareness.off("update", this.handleAwarenessUpdate);
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", this.handleBeforeUnload);
      }
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.destroyed = true;
    this.doc.off("update", this.handleLocalUpdate);
    this.stopPing();
    this.discardPendingUpdates();
    if (this.awarenessSendTimer !== null) {
      window.clearTimeout(this.awarenessSendTimer);
      this.awarenessSendTimer = null;
    }
    this.awarenessPending.clear();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.synced = false;
    this.chunkBuf.clear();
    this.detachSocket();
  }
}
