import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readTabBlock(): string {
  return readFileSync(join(process.cwd(), "src/lib/tiptapExtensions/tabBlock.tsx"), "utf8");
}

function readEditorCss(): string {
  return readFileSync(join(process.cwd(), "src/index.css"), "utf8");
}

describe("tab block spacing", () => {
  it("탭 블럭의 상하 여백과 패널 상하 padding을 제거한다", () => {
    const source = readTabBlock();
    const css = readEditorCss();

    expect(source).toContain("qn-tab-block my-0");
    expect(source).toContain("qn-tab-panels relative min-w-0 flex-1 overflow-hidden bg-white/70 px-4 py-0");
    expect(css).not.toContain("[data-tab-block][data-tab-placement=\"bottom\"] .qn-tab-panels");
    expect(css).not.toContain("[data-tab-block][data-tab-placement=\"top\"] .qn-tab-panels");
  });

  it("상단/하단 탭 버튼 시작점과 기본 폭을 조정한다", () => {
    const source = readTabBlock();

    expect(source).toContain('placement === "top" || placement === "bottom" ? "pl-3" : "pl-2"');
    expect(source).toContain("px-[0.8125rem]");
    expect(source).toContain("max-w-[11.7rem]");
  });
});
