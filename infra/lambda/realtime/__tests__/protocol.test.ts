import { describe, it, expect } from "vitest";
import { encodeBytes, decodeBytes, parseClientMessage, serializeServerMessage } from "../protocol";

describe("protocol", () => {
  it("bytes base64 라운드트립", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(Array.from(decodeBytes(encodeBytes(bytes)))).toEqual([1, 2, 3, 250]);
  });
  it("update 메시지 파싱", () => {
    const raw = JSON.stringify({ t: "update", update: encodeBytes(new Uint8Array([9])) });
    const msg = parseClientMessage(raw);
    expect(msg?.t).toBe("update");
    expect(msg?.t === "update" && Array.from(msg.update)).toEqual([9]);
  });
  it("잘못된 메시지는 null", () => {
    expect(parseClientMessage("{not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "bogus" }))).toBeNull();
  });

  it("awareness 클라이언트 메시지를 파싱한다", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const raw = JSON.stringify({ t: "awareness", update: encodeBytes(bytes) });
    expect(parseClientMessage(raw)).toEqual({ t: "awareness", update: bytes });
  });

  it("awareness 서버 메시지를 직렬화한다", () => {
    const bytes = new Uint8Array([4, 5]);
    const raw = serializeServerMessage({ t: "awareness", update: bytes });
    const obj = JSON.parse(raw);
    expect(obj.t).toBe("awareness");
    expect(decodeBytes(obj.update)).toEqual(bytes);
  });
});
