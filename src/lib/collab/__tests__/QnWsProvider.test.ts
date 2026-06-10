import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
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

function makeProvider() {
  const doc = new Y.Doc();
  const socket = new FakeSocket();
  const provider = new QnWsProvider({
    doc,
    url: "wss://x/dev?token=t&pageId=p",
    socketFactory: () => socket as unknown as WebSocket,
  });
  return { doc, socket, provider };
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
});
