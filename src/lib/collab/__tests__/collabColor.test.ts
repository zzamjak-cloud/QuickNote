import { describe, it, expect } from "vitest";
import { collabColor } from "../collabColor";

describe("collabColor", () => {
  it("같은 seed 는 항상 같은 색을 반환한다(결정성)", () => {
    expect(collabColor("member-a")).toBe(collabColor("member-a"));
  });

  it("#RRGGBB 6자리 hex 를 반환한다(yCursorPlugin 제약)", () => {
    expect(collabColor("member-a")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(collabColor("x")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("빈 문자열도 유효한 색을 반환한다", () => {
    expect(collabColor("")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
