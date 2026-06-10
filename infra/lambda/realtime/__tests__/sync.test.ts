import { describe, it, expect } from "vitest";
import { isAwarenessMessage } from "../sync";
import { parseClientMessage, encodeBytes } from "../protocol";

describe("sync awareness 분기", () => {
  it("awareness 메시지는 영속 대상이 아니다(isAwarenessMessage=true)", () => {
    const msg = parseClientMessage(JSON.stringify({ t: "awareness", update: encodeBytes(new Uint8Array([1])) }));
    expect(msg).not.toBeNull();
    expect(isAwarenessMessage(msg!)).toBe(true);
  });

  it("update 메시지는 영속 대상이다(isAwarenessMessage=false)", () => {
    const msg = parseClientMessage(JSON.stringify({ t: "update", update: encodeBytes(new Uint8Array([1])) }));
    expect(isAwarenessMessage(msg!)).toBe(false);
  });
});
