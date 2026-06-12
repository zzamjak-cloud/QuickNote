import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { QnWsProvider } from "../QnWsProvider";
import { encodeBytes } from "../wsProtocol";

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

  it("로컬 awareness 변경 시 awareness 메시지를 전송한다", () => {
    const { socket, provider, awareness } = makeProvider(true);
    provider.connect();
    socket.open();
    socket.sent.length = 0;
    awareness!.setLocalStateField("user", { name: "A", color: "#2563eb" });
    const aw = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "awareness");
    expect(aw.length).toBeGreaterThanOrEqual(1);
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
    // offline 후 ws.close()→onclose 가 disconnected 로 되돌리면 안 됨 — 마지막은 offline
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
    expect(created).toBe(2); // online 시 즉시 새 connect
    provider.destroy();
  });
});
