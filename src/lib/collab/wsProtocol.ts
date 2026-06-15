// 클라이언트 WebSocket 메시지 직렬화 + 대용량 메시지 청킹.
// 서버 infra/lambda/realtime/protocol.ts 의 계약과 일치해야 한다.
//
// 직렬화는 base64+JSON 텍스트를 쓴다. API Gateway WebSocket 의 route selection
// ($request.body.action)이 메시지를 JSON 으로 평가하므로, 바이너리 프레임은 $default
// 라우트에 닿지 못해 드롭된다(편집 불가 사고). 따라서 텍스트(JSON)를 유지한다.
//
// API GW WebSocket 의 프레임 한도(32KB)를 넘으면 연결이 끊기므로, 28KB 초과 직렬화
// 문자열은 chunk 메시지로 분할한다.

export type ClientMessage =
  | { t: "hello"; sv: Uint8Array }
  | { t: "update"; update: Uint8Array }
  | { t: "sv-reply"; update: Uint8Array }
  | { t: "awareness"; update: Uint8Array };

export type ServerMessage =
  | { t: "sync"; update: Uint8Array; sv: Uint8Array }
  | { t: "update"; update: Uint8Array }
  | { t: "awareness"; update: Uint8Array };

// Uint8Array → base64 문자열 (서버 Buffer.toString("base64") 와 바이트 동일)
export function encodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

// base64 문자열 → Uint8Array
export function decodeBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 클라이언트→서버 메시지를 JSON 문자열로 직렬화
export function serializeClientMessage(msg: ClientMessage): string {
  if (msg.t === "hello") return JSON.stringify({ t: "hello", sv: encodeBytes(msg.sv) });
  return JSON.stringify({ t: msg.t, update: encodeBytes(msg.update) });
}

// 서버→클라이언트 메시지 파싱. 형식이 맞지 않으면 null
export function parseServerMessage(raw: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.t === "sync" && typeof o.update === "string" && typeof o.sv === "string") {
    return { t: "sync", update: decodeBytes(o.update), sv: decodeBytes(o.sv) };
  }
  if (o.t === "update" && typeof o.update === "string") {
    return { t: "update", update: decodeBytes(o.update) };
  }
  if (o.t === "awareness" && typeof o.update === "string") {
    return { t: "awareness", update: decodeBytes(o.update) };
  }
  return null;
}

// 이 길이(문자)를 넘는 직렬화 메시지는 chunk 로 분할한다.
// API GW WebSocket 의 프레임 한도는 32KB(메시지 128KB). 브라우저는 한 ws.send 를 단일
// 프레임으로 보내므로, 32KB 를 넘는 청크는 API GW 가 거부하며 연결을 끊는다. 따라서 프레임
// 한도 내(28KB)로 유지해야 한다 — 메시지 128KB 가 아니라 프레임 32KB 가 실질 상한이다.
export const CHUNK_THRESHOLD = 28 * 1024;
// chunk JSON 래퍼({t,id,i,n,body:""}) 여유분.
const CHUNK_WRAPPER_RESERVE = 256;

// 새 메시지 식별자(32자 hex).
export function newMsgId(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
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

// chunk 메시지면 파싱, 아니면 null.
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
