import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import {
  captureCollaborationViewportAnchor,
  findEditorScrollHost,
  restoreCollaborationViewportAnchor,
} from "../collabViewportAnchor";

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    width: 600,
    height,
    right: 600,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("collaboration viewport anchor", () => {
  it("keeps the selected block at the same viewport offset after a remote insertion above", () => {
    const scroller = document.createElement("div");
    scroller.className = "qn-editor-body-scroll";
    const editorDom = document.createElement("div");
    const block = document.createElement("p");
    block.dataset.id = "editing-block";
    editorDom.appendChild(block);
    scroller.appendChild(editorDom);
    document.body.appendChild(scroller);

    let blockTop = 180;
    scroller.scrollTop = 400;
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000, configurable: true },
      clientHeight: { value: 600, configurable: true },
    });
    scroller.getBoundingClientRect = () => rect(0, 600);
    block.getBoundingClientRect = () => rect(blockTop, 40);

    const view = {
      dom: editorDom,
      nodeDOM: () => block,
      state: {
        selection: {
          from: 5,
          $from: { depth: 1, before: () => 4 },
        },
      },
    } as unknown as Pick<EditorView, "dom" | "nodeDOM" | "state">;

    const anchor = captureCollaborationViewportAnchor(view, scroller);
    expect(anchor?.blockId).toBe("editing-block");

    blockTop = 460;
    expect(restoreCollaborationViewportAnchor(view, scroller, anchor!)).toBe(true);
    expect(scroller.scrollTop).toBe(680);
  });

  it("finds only the editor's own scroll host", () => {
    const scroller = document.createElement("div");
    scroller.className = "qn-editor-body-scroll";
    const editorDom = document.createElement("div");
    scroller.appendChild(editorDom);

    expect(findEditorScrollHost(editorDom)).toBe(scroller);
  });
});
