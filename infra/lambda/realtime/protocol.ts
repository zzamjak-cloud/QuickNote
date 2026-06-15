// 클라이언트·서버 공용 WebSocket 메시지 타입 + base64(Yjs 바이트) 유틸 + 청킹(서버).
// 클라이언트 src/lib/collab/wsProtocol.ts 와 계약이 일치해야 한다.
//
// 직렬화는 base64+JSON 텍스트. API GW WebSocket route selection($request.body.action)이
// 메시지를 JSON 으로 평가하므로 바이너리 프레임은 $default 에 닿지 못한다(텍스트 유지).
// 28KB 초과 직렬화 메시지는 chunk 로 분할해 API GW 32KB 프레임 한도를 회피한다.
import { webcrypto } from "node:crypto";

export type ClientMessage =
  | { t: "hello"; sv: Uint8Array }
  | { t: "update"; update: Uint8Array }
  | { t: "sv-reply"; update: Uint8Array }
  | { t: "awareness"; update: Uint8Array };

export type ServerMessage =
  | { t: "sync"; update: Uint8Array; sv: Uint8Array }
  | { t: "update"; update: Uint8Array }
  | { t: "awareness"; update: Uint8Array };

export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
export function decodeBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.t === "hello" && typeof o.sv === "string") return { t: "hello", sv: decodeBytes(o.sv) };
  if (o.t === "update" && typeof o.update === "string") return { t: "update", update: decodeBytes(o.update) };
  if (o.t === "sv-reply" && typeof o.update === "string") return { t: "sv-reply", update: decodeBytes(o.update) };
  if (o.t === "awareness" && typeof o.update === "string") return { t: "awareness", update: decodeBytes(o.update) };
  return null;
}

export function serializeServerMessage(msg: ServerMessage): string {
  if (msg.t === "sync") return JSON.stringify({ t: "sync", update: encodeBytes(msg.update), sv: encodeBytes(msg.sv) });
  return JSON.stringify({ t: msg.t, update: encodeBytes(msg.update) });
}

// 이 길이(문자)를 넘는 직렬화 메시지는 chunk 로 분할한다.
// API GW WebSocket 의 프레임 한도는 32KB(메시지 128KB). 브라우저는 한 ws.send 를 단일
// 프레임으로 보내므로, 32KB 를 넘는 청크는 API GW 가 거부하며 연결을 끊는다. 따라서 프레임
// 한도 내(28KB)로 유지해야 한다 — 메시지 128KB 가 아니라 프레임 32KB 가 실질 상한이다.
export const CHUNK_THRESHOLD = 28 * 1024;
const CHUNK_WRAPPER_RESERVE = 256;

// 새 메시지 식별자(32자 hex).
export function newMsgId(): string {
  const a = new Uint8Array(16);
  webcrypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += a[i]!.toString(16).padStart(2, "0");
  return s;
}

// 직렬화 문자열을 임계 이하면 그대로, 초과면 chunk 메시지(JSON 문자열)들로 분할한다.
export function splitMessage(
  serialized: string,
  msgId: string,
  threshold = CHUNK_THRESHOLD,
): string[] {
  if (serialized.length <= threshold) return [serialized];
  const partSize = threshold - CHUNK_WRAPPER_RESERVE;
  const n = Math.ceil(serialized.length / partSize);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const body = serialized.slice(i * partSize, (i + 1) * partSize);
    out.push(JSON.stringify({ t: "chunk", id: msgId, i, n, body }));
  }
  return out;
}

export type ChunkMsg = { t: "chunk"; id: string; i: number; n: number; body: string };

export function parseChunk(raw: string): ChunkMsg | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (
    o.t === "chunk"
    && typeof o.id === "string"
    && typeof o.body === "string"
    && Number.isInteger(o.i)
    && Number.isInteger(o.n)
  ) {
    return { t: "chunk", id: o.id, i: o.i as number, n: o.n as number, body: o.body };
  }
  return null;
}
