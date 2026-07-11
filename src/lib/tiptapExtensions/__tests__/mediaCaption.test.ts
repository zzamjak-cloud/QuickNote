import { describe, it, expect, vi } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import { toggleSelectedMediaCaption } from "../mediaCaption";

// applyCaptionToggle 의 3단계 동작을 toggleSelectedMediaCaption 경유로 검증한다:
//  - 캡션 없음(null)      → 빈 캡션("") 생성
//  - 빈 캡션("")          → 제거(null)
//  - 내용 있는 캡션("텍스트") → 유지(updateAttributes 미호출, 포커스만)

type FakeChain = {
  setNodeSelection: (from: number) => FakeChain;
  updateAttributes: (name: string, attrs: Record<string, unknown>) => FakeChain;
  run: () => void;
};

function makeEditor(caption: string | null) {
  const updateCalls: Array<{ name: string; attrs: Record<string, unknown> }> = [];
  const chain: FakeChain = {
    setNodeSelection: () => chain,
    updateAttributes: (name, attrs) => {
      updateCalls.push({ name, attrs });
      return chain;
    },
    run: () => {},
  };
  const node = {
    type: { name: "image" },
    attrs: { caption, captionAlign: "left" },
  };
  // NodeSelection instanceof 체크를 통과시키기 위해 프로토타입을 붙인다.
  const sel = Object.create(NodeSelection.prototype) as NodeSelection & {
    node: typeof node;
    from: number;
  };
  sel.node = node;
  // Selection.prototype.from 은 getter 라 대입이 불가 — own 데이터 속성으로 shadow.
  Object.defineProperty(sel, "from", { value: 3, configurable: true });
  const editor = {
    state: { selection: sel },
    chain: () => chain,
    view: { nodeDOM: () => null },
  } as unknown as import("@tiptap/react").Editor;
  return { editor, updateCalls };
}

describe("toggleSelectedMediaCaption (3단계 캡션 토글)", () => {
  it("캡션 없음 → 빈 캡션 생성", () => {
    const { editor, updateCalls } = makeEditor(null);
    expect(toggleSelectedMediaCaption(editor, ["image"])).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].attrs.caption).toBe("");
  });

  it("빈 캡션 → 제거(null)", () => {
    const { editor, updateCalls } = makeEditor("");
    toggleSelectedMediaCaption(editor, ["image"]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].attrs.caption).toBeNull();
  });

  it("내용 있는 캡션 → 유지(속성 변경 없음, 유실 방지)", () => {
    const { editor, updateCalls } = makeEditor("설명 텍스트");
    vi.stubGlobal("requestAnimationFrame", () => 0);
    toggleSelectedMediaCaption(editor, ["image"]);
    expect(updateCalls).toHaveLength(0); // 삭제하지 않는다
    vi.unstubAllGlobals();
  });

  it("공백만 있는 캡션은 빈 캡션 취급 → 제거", () => {
    const { editor, updateCalls } = makeEditor("   ");
    toggleSelectedMediaCaption(editor, ["image"]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].attrs.caption).toBeNull();
  });
});
