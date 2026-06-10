import { describe, it, expect } from "vitest";
import {
  encodeBytes,
  decodeBytes,
  serializeClientMessage,
  parseServerMessage,
} from "../wsProtocol";

describe("wsProtocol", () => {
  it("base64 라운드트립", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(Array.from(decodeBytes(encodeBytes(bytes)))).toEqual(Array.from(bytes));
  });

  it("hello 메시지 직렬화", () => {
    const raw = serializeClientMessage({ t: "hello", sv: new Uint8Array([1, 2]) });
    const obj = JSON.parse(raw);
    expect(obj.t).toBe("hello");
    expect(Array.from(decodeBytes(obj.sv))).toEqual([1, 2]);
  });

  it("update / sv-reply 직렬화", () => {
    const u = new Uint8Array([9, 8, 7]);
    expect(JSON.parse(serializeClientMessage({ t: "update", update: u })).t).toBe("update");
    expect(JSON.parse(serializeClientMessage({ t: "sv-reply", update: u })).t).toBe("sv-reply");
  });

  it("서버 sync 메시지 파싱", () => {
    const raw = JSON.stringify({
      t: "sync",
      update: encodeBytes(new Uint8Array([1])),
      sv: encodeBytes(new Uint8Array([2])),
    });
    const msg = parseServerMessage(raw);
    expect(msg?.t).toBe("sync");
    if (msg?.t === "sync") {
      expect(Array.from(msg.update)).toEqual([1]);
      expect(Array.from(msg.sv)).toEqual([2]);
    }
  });

  it("서버 update 메시지 파싱", () => {
    const raw = JSON.stringify({ t: "update", update: encodeBytes(new Uint8Array([5])) });
    const msg = parseServerMessage(raw);
    expect(msg?.t).toBe("update");
    if (msg?.t === "update") expect(Array.from(msg.update)).toEqual([5]);
  });

  it("잘못된 메시지는 null", () => {
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "nope" }))).toBeNull();
  });

  it("awareness 클라이언트 메시지를 직렬화한다", () => {
    const bytes = new Uint8Array([5, 6, 7]);
    const raw = serializeClientMessage({ t: "awareness", update: bytes });
    const obj = JSON.parse(raw);
    expect(obj.t).toBe("awareness");
    expect(decodeBytes(obj.update)).toEqual(bytes);
  });

  it("awareness 서버 메시지를 파싱한다", () => {
    const bytes = new Uint8Array([9, 8]);
    const raw = JSON.stringify({ t: "awareness", update: encodeBytes(bytes) });
    const msg = parseServerMessage(raw);
    expect(msg).toEqual({ t: "awareness", update: bytes });
  });
});
