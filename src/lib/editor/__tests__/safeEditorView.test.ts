import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { getMountedEditorView } from "../safeEditorView";

describe("getMountedEditorView", () => {
  it("에디터가 없거나 파괴된 상태면 null을 반환한다", () => {
    expect(getMountedEditorView(null)).toBeNull();
    expect(
      getMountedEditorView({ isDestroyed: true } as unknown as Editor),
    ).toBeNull();
  });

  it("TipTap view가 아직 마운트되지 않아 throw해도 null을 반환한다", () => {
    const editor = {
      isDestroyed: false,
      get view(): never {
        throw new Error("view is not available");
      },
    } as unknown as Editor;

    expect(getMountedEditorView(editor)).toBeNull();
  });

  it("마운트된 view를 그대로 반환한다", () => {
    const view = {} as EditorView;
    const editor = {
      isDestroyed: false,
      view,
    } as unknown as Editor;

    expect(getMountedEditorView(editor)).toBe(view);
  });
});
