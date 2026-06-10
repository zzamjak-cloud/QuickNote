import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { mergeState, diffForClient, stateVectorOf } from "../yjsStore";

function docWithText(text: string): Uint8Array {
  const d = new Y.Doc();
  d.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(d);
}

describe("yjsStore 순수 로직", () => {
  it("두 update를 머지하면 양쪽 변경이 모두 반영", () => {
    const a = docWithText("foo");
    const b = (() => {
      const d = new Y.Doc();
      Y.applyUpdate(d, a);
      d.getText("t").insert(3, "bar");
      return Y.encodeStateAsUpdate(d);
    })();
    const merged = mergeState([a, b]);
    const d = new Y.Doc();
    Y.applyUpdate(d, merged);
    expect(d.getText("t").toString()).toBe("foobar");
  });

  it("diffForClient는 클라 SV 기준 누락분만 돌려준다", () => {
    const server = docWithText("hello");
    const clientDoc = new Y.Doc();
    const clientSV = Y.encodeStateVector(clientDoc);
    const diff = diffForClient(server, clientSV);
    const applied = new Y.Doc();
    Y.applyUpdate(applied, diff);
    expect(applied.getText("t").toString()).toBe("hello");
  });

  it("stateVectorOf 왕복", () => {
    const state = docWithText("x");
    const sv = stateVectorOf(state);
    const d = new Y.Doc();
    Y.applyUpdate(d, state);
    expect(Array.from(sv)).toEqual(Array.from(Y.encodeStateVector(d)));
  });
});
