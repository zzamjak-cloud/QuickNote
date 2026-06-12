import { describe, expect, it } from "vitest";
import {
  diffDocBlocks,
  parseChangedUnits,
  parseContributors,
  summarizeChangedUnits,
} from "../blockDiff";

const block = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

const docOf = (...blocks: unknown[]) => ({ type: "doc", content: blocks });

describe("diffDocBlocks", () => {
  it("빈 블럭 추가와 위치 이동은 diff 에 잡히지 않는다", () => {
    const before = docOf(block("a", "하나"), block("b", "둘"));
    const after = docOf(
      { type: "paragraph", attrs: { id: "z" } },
      block("b", "둘"),
      block("a", "하나"),
    );
    expect(diffDocBlocks(before, after)).toEqual([]);
  });

  it("수정·추가·삭제를 블럭 노드 페어로 반환한다", () => {
    const before = docOf(block("a", "하나"), block("b", "둘"));
    const after = docOf(block("a", "하나!"), block("c", "셋"));
    const diff = diffDocBlocks(before, after);
    expect(diff.map((d) => [d.kind, d.id])).toEqual([
      ["modified", "a"],
      ["added", "c"],
      ["removed", "b"],
    ]);
    expect(diff[0]?.before).toEqual(block("a", "하나"));
    expect(diff[0]?.after).toEqual(block("a", "하나!"));
  });

  it("JSON 문자열 doc 과 키 순서 차이를 흡수한다", () => {
    const before = JSON.stringify(docOf(block("a", "x")));
    const after = JSON.stringify({
      type: "doc",
      content: [{ content: [{ text: "x", type: "text" }], attrs: { id: "a" }, type: "paragraph" }],
    });
    expect(diffDocBlocks(before, after)).toEqual([]);
  });

  it("id 없는 레거시 블럭은 시그니처 매칭으로 폴백한다", () => {
    const legacy = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const before = docOf(legacy("하나"), legacy("둘"));
    const after = docOf(legacy("둘"), legacy("하나")); // 순서만 변경
    expect(diffDocBlocks(before, after)).toEqual([]);
    const changed = diffDocBlocks(docOf(legacy("하나")), docOf(legacy("둘")));
    expect(changed.map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("summarizeChangedUnits / 파서", () => {
  it("단위 키를 한 줄 요약으로 만든다", () => {
    expect(summarizeChangedUnits(["block:a", "block:b", "cell:c1", "meta:title"])).toBe(
      "블럭 2개 · 셀 1개 · 제목",
    );
    expect(summarizeChangedUnits(JSON.stringify(["column:c1", "preset:p1"]))).toBe(
      "컬럼 1개 · 뷰 1개",
    );
    expect(summarizeChangedUnits(null)).toBe("");
  });

  it("contributors/changedUnits AWSJSON 문자열을 파싱한다", () => {
    expect(parseContributors(JSON.stringify([{ memberId: "m1", name: "A" }, { bad: 1 }]))).toEqual([
      { memberId: "m1", name: "A" },
    ]);
    expect(parseChangedUnits(JSON.stringify(["block:a", 3]))).toEqual(["block:a"]);
  });
});
