// 8인 동시 편집 — 클라이언트 프로토콜 레벨 시뮬레이션.
// 실제 QnWsProvider 8개를 in-memory 서버(실제 wsProtocol 직렬화 사용)에 물리고,
// 전송 유실(update 드롭)을 주입해도 hello 재동기화의 sv-reply 조건부 재조정으로
// 전원의 편집이 서버 권위 상태에 수렴하는지 검증한다(2026-07-10 사고 회귀 방지).
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { QnWsProvider } from "../QnWsProvider";
import {
  encodeBytes,
  decodeBytes,
  parseChunk,
  splitMessage,
  newMsgId,
} from "../wsProtocol";

// 클라 직렬화(serializeClientMessage)와 동형의 서버측 파싱/직렬화 — 테스트 로컬 구현.
type ParsedClientMsg =
  | { t: "hello"; sv: Uint8Array }
  | { t: "update" | "sv-reply" | "awareness"; update: Uint8Array }
  | { t: "ping" };
function parseClientMsg(raw: string): ParsedClientMsg | null {
  try {
    const o = JSON.parse(raw) as { t?: string; sv?: string; update?: string };
    if (o.t === "hello" && typeof o.sv === "string") return { t: "hello", sv: decodeBytes(o.sv) };
    if ((o.t === "update" || o.t === "sv-reply" || o.t === "awareness") && typeof o.update === "string") {
      return { t: o.t, update: decodeBytes(o.update) };
    }
    if (o.t === "ping") return { t: "ping" };
    return null;
  } catch {
    return null;
  }
}
function serializeServerMsg(msg: { t: "sync"; update: Uint8Array; sv: Uint8Array } | { t: "update"; update: Uint8Array }): string {
  if (msg.t === "sync") {
    return JSON.stringify({ t: "sync", update: encodeBytes(msg.update), sv: encodeBytes(msg.sv) });
  }
  return JSON.stringify({ t: "update", update: encodeBytes(msg.update) });
}

// ===== in-memory 협업 서버(sync.ts 의 hello/update 처리와 동형) =====
class FakeCollabServer {
  updates: Uint8Array[] = [];
  sockets = new Set<ServerBoundSocket>();
  /** true 를 반환하면 해당 update 수신을 유실시킨다(서버 append 실패/드롭 시뮬레이션). */
  dropUpdate: (count: number) => boolean = () => false;
  private updateCount = 0;
  private chunkBuf = new Map<string, { parts: string[]; n: number; got: number }>();

  state(): Uint8Array {
    if (this.updates.length === 0) return Y.encodeStateAsUpdate(new Y.Doc());
    return Y.mergeUpdates(this.updates);
  }

  receive(from: ServerBoundSocket, raw: string): void {
    const chunk = parseChunk(raw);
    if (chunk) {
      let entry = this.chunkBuf.get(chunk.id);
      if (!entry) {
        entry = { parts: new Array<string>(chunk.n), n: chunk.n, got: 0 };
        this.chunkBuf.set(chunk.id, entry);
      }
      if (entry.parts[chunk.i] === undefined) entry.got += 1;
      entry.parts[chunk.i] = chunk.body;
      if (entry.got < entry.n) return;
      this.chunkBuf.delete(chunk.id);
      this.receive(from, entry.parts.join(""));
      return;
    }
    const msg = parseClientMsg(raw);
    if (!msg) return;
    if (msg.t === "hello") {
      const state = this.state();
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const reply = serializeServerMsg({
        t: "sync",
        update: Y.encodeStateAsUpdate(doc, msg.sv),
        sv: Y.encodeStateVector(doc),
      });
      for (const f of splitMessage(reply, newMsgId())) from.deliver(f);
      return;
    }
    if (msg.t === "ping" || msg.t === "awareness") return;
    // update / sv-reply — 영속 + 팬아웃
    const update = msg.update;
    this.updateCount += 1;
    if (msg.t === "update" && this.dropUpdate(this.updateCount)) return; // 유실 주입
    this.updates.push(update);
    const frame = serializeServerMsg({ t: "update", update });
    for (const s of this.sockets) {
      if (s !== from) for (const f of splitMessage(frame, newMsgId())) s.deliver(f);
    }
  }
}

// provider 가 기대하는 WebSocket 인터페이스를 서버에 물린 가짜 소켓.
class ServerBoundSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(private server: FakeCollabServer) {}
  send(d: string) {
    this.server.receive(this, d);
  }
  close() {
    this.readyState = ServerBoundSocket.CLOSED;
    this.server.sockets.delete(this);
    this.onclose?.();
  }
  open() {
    this.readyState = ServerBoundSocket.OPEN;
    this.server.sockets.add(this);
    this.onopen?.();
  }
  deliver(raw: string) {
    this.onmessage?.({ data: raw });
  }
}

function connectClient(server: FakeCollabServer) {
  const doc = new Y.Doc();
  const socket = new ServerBoundSocket(server);
  const provider = new QnWsProvider({
    doc,
    url: "wss://fake/dev?pageId=p",
    socketFactory: () => socket as unknown as WebSocket,
  });
  provider.connect();
  socket.open();
  return { doc, provider, socket };
}

describe("8인 동시 편집 프로토콜 시뮬레이션", () => {
  it("드롭 없는 정상 경로: 8명의 편집이 전원 문서에 수렴한다", async () => {
    const server = new FakeCollabServer();
    const clients = Array.from({ length: 8 }, () => connectClient(server));
    // update 송신은 leading+쿨다운 배칭이라, 각 편집 후 쿨다운(250ms)을 넘겨 flush 를 보장한다.
    for (let round = 0; round < 3; round += 1) {
      clients.forEach(({ doc }, i) => {
        const t = doc.getText(`c${i}`);
        t.insert(t.length, `r${round}`);
      });
      await new Promise((r) => setTimeout(r, 320));
    }
    for (const [i] of clients.entries()) {
      // 서버 권위 상태에 전원의 편집 존재
      const authoritative = new Y.Doc();
      Y.applyUpdate(authoritative, server.state());
      expect(authoritative.getText(`c${i}`).toString()).toBe("r0r1r2");
    }
    // 각 피어 문서도 수렴
    for (const { doc } of clients) {
      for (let i = 0; i < 8; i += 1) {
        expect(doc.getText(`c${i}`).toString()).toBe("r0r1r2");
      }
    }
    clients.forEach(({ provider }) => provider.destroy());
  }, 30_000);

  it("대용량 편집(이미지 다수 첨부 등 28KB 초과)도 청킹 왕복으로 전원 수렴한다", async () => {
    const server = new FakeCollabServer();
    const clients = Array.from({ length: 8 }, () => connectClient(server));
    // 클라 0 이 60KB 텍스트 삽입 — update 가 CHUNK_THRESHOLD(28KB) 를 넘어 분할 전송된다.
    const big = "x".repeat(60 * 1024);
    clients[0].doc.getText("big").insert(0, big);
    await new Promise((r) => setTimeout(r, 320));
    // 서버 권위 + 나머지 7명 모두에 대용량 본문이 온전히 도착.
    const authoritative = new Y.Doc();
    Y.applyUpdate(authoritative, server.state());
    expect(authoritative.getText("big").toString().length).toBe(big.length);
    for (const { doc } of clients.slice(1)) {
      expect(doc.getText("big").toString().length).toBe(big.length);
    }
    clients.forEach(({ provider }) => provider.destroy());
  }, 30_000);

  it("update 가 서버에서 유실돼도 hello 재동기화(sv-reply 재조정)로 자기치유된다", async () => {
    const server = new FakeCollabServer();
    // 3번째 update 마다 서버 수신 유실 — 8인 폭주 중 append 실패/스로틀 드롭 시뮬레이션.
    server.dropUpdate = (n) => n % 3 === 0;
    const clients = Array.from({ length: 8 }, () => connectClient(server));
    for (let round = 0; round < 4; round += 1) {
      clients.forEach(({ doc }, i) => {
        const t = doc.getText(`c${i}`);
        t.insert(t.length, `r${round}`);
      });
      await new Promise((r) => setTimeout(r, 320));
    }
    // 유실이 실제로 발생했는지(전제 성립) 확인 — 서버 상태에 빠진 편집이 있어야 한다.
    const before = new Y.Doc();
    Y.applyUpdate(before, server.state());
    const lostBefore = Array.from({ length: 8 }, (_, i) =>
      before.getText(`c${i}`).toString(),
    ).filter((s) => s !== "r0r1r2r3").length;
    expect(lostBefore).toBeGreaterThan(0);

    // 유실 중단 후 탭 전면 복귀(visibilitychange) → hello 재동기화 → sv-reply 조건부 재전송.
    server.dropUpdate = () => false;
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 50));

    const after = new Y.Doc();
    Y.applyUpdate(after, server.state());
    for (let i = 0; i < 8; i += 1) {
      // 서버 권위 상태에 전원의 편집이 복구돼야 한다(영구 유실 없음).
      expect(after.getText(`c${i}`).toString()).toBe("r0r1r2r3");
    }
    clients.forEach(({ provider }) => provider.destroy());
  }, 30_000);
});
