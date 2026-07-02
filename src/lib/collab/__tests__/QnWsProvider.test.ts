import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { QnWsProvider } from "../QnWsProvider";
import { encodeBytes, decodeBytes, splitMessage, newMsgId } from "../wsProtocol";

// 최소 가짜 WebSocket — provider 가 기대하는 인터페이스만 구현.
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(raw: string) {
    this.onmessage?.({ data: raw });
  }
}

function makeProvider(withAwareness = false) {
  const doc = new Y.Doc();
  const socket = new FakeSocket();
  const awareness = withAwareness ? new Awareness(doc) : undefined;
  const provider = new QnWsProvider({
    doc,
    url: "wss://x/dev?token=t&pageId=p",
    socketFactory: () => socket as unknown as WebSocket,
    awareness,
  });
  return { doc, socket, provider, awareness };
}

describe("QnWsProvider", () => {
  it("연결되면 hello{sv} 를 전송한다", () => {
    const { socket, provider } = makeProvider();
    provider.connect();
    socket.open();
    expect(socket.sent.length).toBe(1);
    expect(JSON.parse(socket.sent[0]).t).toBe("hello");
  });

  it("keepalive 타이머는 hello 가 아닌 경량 ping 을 전송한다", () => {
    vi.useFakeTimers();
    try {
      const { socket, provider } = makeProvider();
      provider.connect();
      socket.open();
      socket.sent.length = 0;
      vi.advanceTimersByTime(240_000);
      const msgs = socket.sent.map((s) => JSON.parse(s));
      expect(msgs.filter((m) => m.t === "ping").length).toBe(1);
      expect(msgs.filter((m) => m.t === "hello").length).toBe(0);
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("탭 전면 복귀(visibilitychange) 시 hello 재동기화를 보낸다", () => {
    const { socket, provider } = makeProvider();
    provider.connect();
    socket.open();
    socket.sent.length = 0;
    document.dispatchEvent(new Event("visibilitychange")); // jsdom 기본 visibilityState=visible
    const hellos = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "hello");
    expect(hellos.length).toBe(1);
    provider.destroy();
  });

  it("destroy 후에는 visibilitychange 에 hello 를 보내지 않는다", () => {
    const { socket, provider } = makeProvider();
    provider.connect();
    socket.open();
    provider.destroy();
    socket.sent.length = 0;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(socket.sent.length).toBe(0);
  });

  it("sync 수신 시 applyUpdate 후 sv-reply 를 보내고 synced 콜백 호출", () => {
    const { socket, provider, doc } = makeProvider();
    const onSynced = vi.fn();
    provider.on("synced", onSynced);
    provider.connect();
    socket.open();

    const server = new Y.Doc();
    server.getXmlFragment("prosemirror");
    const update = Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc));
    const sv = Y.encodeStateVector(server);
    socket.receive(JSON.stringify({ t: "sync", update: encodeBytes(update), sv: encodeBytes(sv) }));

    const reply = socket.sent.map((s) => JSON.parse(s)).find((m) => m.t === "sv-reply");
    expect(reply).toBeTruthy();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it("두 번째 sync(ping 유발)에는 sv-reply 를 재전송하지 않는다(H3 stale 재오염 방지)", () => {
    const { socket, provider, doc } = makeProvider();
    provider.connect();
    socket.open();

    const server = new Y.Doc();
    server.getXmlFragment("prosemirror");
    const update = Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc));
    const sv = Y.encodeStateVector(server);
    const syncFrame = JSON.stringify({ t: "sync", update: encodeBytes(update), sv: encodeBytes(sv) });

    socket.receive(syncFrame); // 첫 sync → sv-reply 1회
    socket.sent.length = 0;
    socket.receive(syncFrame); // ping 유발 두 번째 sync → sv-reply 없어야 함

    const replies = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "sv-reply");
    expect(replies.length).toBe(0);
  });

  it("로컬 doc 변경 시 update{update} 를 전송한다", () => {
    const { socket, provider, doc } = makeProvider();
    provider.connect();
    socket.open();
    socket.sent.length = 0;

    doc.getText("t").insert(0, "x");
    const updates = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "update");
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it("연속 편집은 배칭되어 즉시 1건 + 쿨다운 후 병합 1건만 전송된다", () => {
    vi.useFakeTimers();
    try {
      const { socket, provider, doc } = makeProvider();
      provider.connect();
      socket.open();
      socket.sent.length = 0;
      // 타이핑 폭주 시뮬레이션 — leading edge 1건 외에는 쿨다운에 묶여야 한다.
      for (let i = 0; i < 10; i += 1) {
        doc.getText("t").insert(i, "x");
      }
      const burst = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "update");
      expect(burst.length).toBe(1);
      vi.advanceTimersByTime(250);
      const after = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "update");
      expect(after.length).toBe(2);
      // 병합 update 를 적용하면 원본과 동일해야 한다(유실 없음).
      const other = new Y.Doc();
      for (const m of after) Y.applyUpdate(other, decodeBytes(m.update));
      expect(other.getText("t").toString()).toBe(doc.getText("t").toString());
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy 는 배칭 중인 편집분을 flush 한다(페이지 이탈 유실 방지)", () => {
    vi.useFakeTimers();
    try {
      const { socket, provider, doc } = makeProvider();
      provider.connect();
      socket.open();
      socket.sent.length = 0;
      doc.getText("t").insert(0, "a"); // leading edge 전송
      doc.getText("t").insert(1, "b"); // 쿨다운 버퍼
      provider.destroy(); // 타이머 만료 전 이탈 — flush 되어야 한다
      const updates = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "update");
      expect(updates.length).toBe(2);
      const other = new Y.Doc();
      for (const m of updates) Y.applyUpdate(other, decodeBytes(m.update));
      expect(other.getText("t").toString()).toBe("ab");
    } finally {
      vi.useRealTimers();
    }
  });

  it("서버 update 수신분은 다시 서버로 echo 하지 않는다", () => {
    const { socket, provider } = makeProvider();
    provider.connect();
    socket.open();
    socket.sent.length = 0;

    const other = new Y.Doc();
    other.getText("t").insert(0, "remote");
    const u = Y.encodeStateAsUpdate(other);
    socket.receive(JSON.stringify({ t: "update", update: encodeBytes(u) }));

    const echoed = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "update");
    expect(echoed.length).toBe(0);
  });

  it("destroy 후에는 doc 변경이 전송되지 않는다", () => {
    const { socket, provider, doc } = makeProvider();
    provider.connect();
    socket.open();
    provider.destroy();
    socket.sent.length = 0;
    doc.getText("t").insert(0, "y");
    expect(socket.sent.length).toBe(0);
  });

  it("연결 수립 전 destroy 는 CONNECTING 소켓을 즉시 close 하지 않는다", () => {
    const { socket, provider } = makeProvider();
    provider.connect();
    provider.destroy();
    expect(socket.readyState).toBe(0);
    socket.open();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(socket.sent.length).toBe(0);
  });

  it("로컬 awareness 변경 시 awareness 메시지를 전송한다", () => {
    const { socket, provider, awareness } = makeProvider(true);
    provider.connect();
    socket.open();
    socket.sent.length = 0;
    awareness!.setLocalStateField("user", { name: "A", color: "#2563eb" });
    const aw = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
    expect(aw.length).toBeGreaterThanOrEqual(1);
  });

  it("연속 awareness 변경은 스로틀되어 즉시 1건 + 쿨다운 후 1건만 전송된다", () => {
    vi.useFakeTimers();
    try {
      const { socket, provider, awareness } = makeProvider(true);
      provider.connect();
      socket.open();
      socket.sent.length = 0;
      // 커서 이동 폭주 시뮬레이션 — leading edge 1건 외에는 쿨다운에 묶여야 한다.
      for (let i = 0; i < 10; i += 1) {
        awareness!.setLocalStateField("cursor", { x: i });
      }
      const sentDuringBurst = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
      expect(sentDuringBurst.length).toBe(1);
      vi.advanceTimersByTime(300);
      const sentAfterCooldown = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
      expect(sentAfterCooldown.length).toBe(2);
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("원격 awareness 수신분은 적용하고 다시 전송하지 않는다", () => {
    const { socket, provider, awareness } = makeProvider(true);
    provider.connect();
    socket.open();
    socket.sent.length = 0;
    const otherDoc = new Y.Doc();
    const other = new Awareness(otherDoc);
    other.setLocalStateField("user", { name: "B", color: "#059669" });
    const update = encodeAwarenessUpdate(other, [otherDoc.clientID]);
    socket.receive(JSON.stringify({ t: "awareness", update: encodeBytes(update) }));
    expect(awareness!.getStates().has(otherDoc.clientID)).toBe(true);
    expect(socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness").length).toBe(0);
  });

  it("연결 open 시 로컬 awareness 상태를 전송한다", () => {
    const { socket, provider, awareness } = makeProvider(true);
    awareness!.setLocalStateField("user", { name: "A", color: "#2563eb" });
    provider.connect();
    socket.open();
    const aw = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
    expect(aw.length).toBeGreaterThanOrEqual(1);
  });

  it("destroy 시 self 제거 awareness 를 전송한다", () => {
    const { socket, provider, awareness } = makeProvider(true);
    awareness!.setLocalStateField("user", { name: "A", color: "#2563eb" });
    provider.connect();
    socket.open();
    socket.sent.length = 0;
    provider.destroy();
    const aw = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
    expect(aw.length).toBeGreaterThanOrEqual(1);
  });

  it("offline 이벤트 시 status offline 을 emit 하고 재연결하지 않는다", () => {
    const { socket, provider } = makeProvider();
    const statuses: string[] = [];
    provider.on("status", (s) => statuses.push(s as string));
    provider.connect();
    socket.open();
    window.dispatchEvent(new Event("offline"));
    expect(statuses).toContain("offline");
    expect(statuses[statuses.length - 1]).toBe("offline");
    provider.destroy();
  });

  it("online 이벤트 시 즉시 재연결을 시도한다(새 소켓 생성)", () => {
    const doc = new Y.Doc();
    let created = 0;
    const sockets: FakeSocket[] = [];
    const provider = new QnWsProvider({
      doc,
      url: "wss://x/dev?token=t&pageId=p",
      socketFactory: () => {
        created += 1;
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
    provider.connect();
    sockets[0].open();
    expect(created).toBe(1);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(created).toBe(2);
    provider.destroy();
  });

  it("청크로 분할되어 도착한 sync 를 재조립해 처리한다", () => {
    const { socket, provider, doc } = makeProvider();
    const onSynced = vi.fn();
    provider.on("synced", onSynced);
    provider.connect();
    socket.open();

    // 큰 본문 서버 doc → sync 직렬화가 임계를 넘어 chunk 로 쪼개져 도착하는 상황.
    const server = new Y.Doc();
    server.getText("big").insert(0, "x".repeat(200 * 1024));
    const update = Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc));
    const sv = Y.encodeStateVector(server);
    const syncFrame = JSON.stringify({ t: "sync", update: encodeBytes(update), sv: encodeBytes(sv) });

    const frames = splitMessage(syncFrame, newMsgId());
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) socket.receive(f);

    expect(onSynced).toHaveBeenCalledTimes(1);
    const reply = socket.sent.map((s) => JSON.parse(s)).find((m) => m.t === "sv-reply" || m.t === "chunk");
    expect(reply).toBeTruthy();
  });

  it("재연결은 maxReconnectAttempts 회까지만 시도하고 이후 중단한다(무한 루프 방지)", () => {
    vi.useFakeTimers();
    try {
      const doc = new Y.Doc();
      const sockets: FakeSocket[] = [];
      const provider = new QnWsProvider({
        doc,
        url: "wss://x/dev?token=t&pageId=p",
        socketFactory: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        },
        maxReconnectAttempts: 3,
      });
      provider.connect(); // 초기 소켓 #1 (CONNECTING)
      // 연결 실패(close) 반복 — 캡에 도달하면 더는 재연결 타이머를 걸지 않아야 한다.
      for (let i = 0; i < 10; i += 1) {
        sockets[sockets.length - 1].close(); // onclose → 재연결 스케줄 or 중단
        vi.runOnlyPendingTimers(); // 스케줄됐다면 reconnect 실행(새 소켓)
      }
      // 초기 1회 + 재연결 3회 = 총 4개 소켓에서 멈춰야 한다.
      expect(sockets.length).toBe(4);
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("재연결 중단 후 online 이벤트가 오면 재시도를 재개한다", () => {
    vi.useFakeTimers();
    try {
      const doc = new Y.Doc();
      const sockets: FakeSocket[] = [];
      const provider = new QnWsProvider({
        doc,
        url: "wss://x/dev?token=t&pageId=p",
        socketFactory: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        },
        maxReconnectAttempts: 3,
      });
      provider.connect();
      for (let i = 0; i < 10; i += 1) {
        sockets[sockets.length - 1].close();
        vi.runOnlyPendingTimers();
      }
      expect(sockets.length).toBe(4); // 캡 도달
      // 네트워크 복귀 시 retries 리셋 → 다시 연결 시도.
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      expect(sockets.length).toBe(5);
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
