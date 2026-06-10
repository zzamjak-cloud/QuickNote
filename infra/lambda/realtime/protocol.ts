// 클라이언트·서버 공용 WebSocket 메시지 타입과 base64(Yjs 바이트) 유틸.
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
