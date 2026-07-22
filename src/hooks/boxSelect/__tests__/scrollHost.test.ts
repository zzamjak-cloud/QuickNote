import { describe, expect, it } from "vitest";
import { resolveBoxSelectScrollHost } from "../scrollHost";

describe("resolveBoxSelectScrollHost", () => {
  it("메인 에디터에서는 자체 스크롤 본문을 사용한다", () => {
    const body = document.createElement("div");
    body.className = "qn-editor-body-scroll overflow-y-auto";
    const editorDom = document.createElement("div");
    body.appendChild(editorDom);

    expect(resolveBoxSelectScrollHost(editorDom)).toBe(body);
  });

  it("bodyOnly 에디터에서는 비스크롤 본문을 건너뛰고 바깥 스크롤 부모를 사용한다", () => {
    const scroller = document.createElement("div");
    scroller.className = "overflow-y-auto";
    const body = document.createElement("div");
    body.className = "qn-editor-body-scroll";
    const editorDom = document.createElement("div");
    body.appendChild(editorDom);
    scroller.appendChild(body);

    expect(resolveBoxSelectScrollHost(editorDom)).toBe(scroller);
  });
});
