import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readEditorCss(): string {
  return readFileSync(join(process.cwd(), "src/index.css"), "utf8");
}

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

describe("page mention spacing", () => {
  it("페이지 멘션은 부모 텍스트 line-height를 유지하면서 라인 중앙에 정렬한다", () => {
    const body = cssRuleBody(readEditorCss(), ".page-mention");

    expect(body).toContain("line-height: inherit;");
    expect(body).toContain("vertical-align: middle;");
  });

  it("페이지 멘션 아이콘은 텍스트 em 단위 안에 들어가 행간을 키우지 않는다", () => {
    const body = cssRuleBody(readEditorCss(), ".page-mention .page-mention-icon");

    expect(body).toContain("width: 1em;");
    expect(body).toContain("height: 1em;");
    expect(body).toContain("font-size: 1em;");
    expect(body).not.toContain("1.5rem");
  });
});
