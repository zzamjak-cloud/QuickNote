import { describe, expect, it, beforeEach } from "vitest";
import { resolveSidebarDrop } from "../lib/sidebarPageTreeCollision";

function installSidebarRow(id: string, rect: Partial<DOMRect> = {}) {
  document.body.innerHTML = `<div data-sidebar-page-row="${id}" data-sidebar-depth="0"></div>`;
  const el = document.querySelector(`[data-sidebar-page-row="${id}"]`);
  if (!el) throw new Error("row not created");
  const nextRect = {
    left: 0,
    right: 240,
    top: 100,
    bottom: 140,
    width: 240,
    height: 40,
    x: 0,
    y: 100,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  el.getBoundingClientRect = () => nextRect;
}

describe("resolveSidebarDrop", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("row 중앙에서는 대상 페이지의 마지막 자식으로 드롭한다", () => {
    installSidebarRow("target");
    expect(
      resolveSidebarDrop({
        overId: "target",
        activeId: "active",
        clientY: 120,
        prev: null,
        isBlocked: () => false,
        isExpanded: () => false,
      }),
    ).toEqual({ overId: "target", mode: "child-last" });
  });

  it("row 상단과 하단은 형제 before/after 드롭으로 유지한다", () => {
    installSidebarRow("target");
    const base = {
      overId: "target",
      activeId: "active",
      prev: null,
      isBlocked: () => false,
      isExpanded: () => false,
    };
    expect(resolveSidebarDrop({ ...base, clientY: 104 }).mode).toBe("before");
    expect(resolveSidebarDrop({ ...base, clientY: 136 }).mode).toBe("after");
  });

  it("펼쳐진 페이지의 하단은 첫 자식 위치로 드롭한다", () => {
    installSidebarRow("target");
    expect(
      resolveSidebarDrop({
        overId: "target",
        activeId: "active",
        clientY: 136,
        prev: null,
        isBlocked: () => false,
        isExpanded: () => true,
      }).mode,
    ).toBe("child-first");
  });
});
