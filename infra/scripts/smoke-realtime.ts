// 실시간 협업 백엔드 스모크 — 2 클라이언트 수렴 확인.
// 사용법: WS_URL=wss://.../prod TOKEN=<Cognito idToken> PAGE_ID=<dev pageId> npx tsx infra/scripts/smoke-realtime.ts
import WebSocket from "ws";
import * as Y from "yjs";

const url = `${process.env.WS_URL}?token=${process.env.TOKEN}&pageId=${process.env.PAGE_ID}`;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function client(label: string): { doc: Y.Doc; ws: WebSocket } {
  const doc = new Y.Doc();
  const ws = new WebSocket(url);
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", sv: b64(Y.encodeStateVector(doc)) })));
  ws.on("message", (raw: Buffer) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "sync" || m.t === "update") Y.applyUpdate(doc, fromB64(m.update));
    console.log(label, "text=", doc.getText("t").toString());
  });
  ws.on("unexpected-response", (_req, res) => console.log(label, "rejected status=", res.statusCode));
  ws.on("error", (e) => console.log(label, "error=", (e as Error).message));
  return { doc, ws };
}

const a = client("A");
setTimeout(() => {
  a.doc.getText("t").insert(0, "hello-from-A");
  a.ws.send(JSON.stringify({ t: "update", update: b64(Y.encodeStateAsUpdate(a.doc)) }));
}, 1500);
// B는 A의 변경을 수신해 동일 텍스트로 수렴하면 성공.
const b = client("B");
setTimeout(() => { a.ws.close(); b.ws.close(); process.exit(0); }, 5000);
