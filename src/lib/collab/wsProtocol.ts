// 클라이언트 WebSocket 메시지 직렬화. 서버 infra/lambda/realtime/protocol.ts 의 계약과 일치해야 한다.
// 브라우저 환경이므로 base64 는 btoa/atob 로 처리한다.

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
