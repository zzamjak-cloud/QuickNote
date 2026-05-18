import { describe, expect, it } from "vitest";
import { matchesMemberSearchQuery, sortByKoreanName } from "../memberSearch";

describe("memberSearch", () => {
  it("이름 중간 문자열로도 검색된다", () => {
    const member = {
      name: "양지원",
      email: "yang@example.com",
      jobRole: "Designer",
    };
    expect(matchesMemberSearchQuery(member, "지")).toBe(true);
    expect(matchesMemberSearchQuery(member, "지원")).toBe(true);
  });

  it("초성 검색을 지원한다", () => {
    const member = {
      name: "홍길동",
      email: "hong@example.com",
      jobRole: "Developer",
    };
    expect(matchesMemberSearchQuery(member, "ㅎㄱ")).toBe(true);
    expect(matchesMemberSearchQuery(member, "ㄱㄷ")).toBe(true);
  });

  it("한글 이름 기준으로 정렬한다", () => {
    const sorted = sortByKoreanName([
      { name: "양지원", id: "2" },
      { name: "김아름", id: "1" },
      { name: "홍길동", id: "3" },
    ]);
    expect(sorted.map((member) => member.name)).toEqual(["김아름", "양지원", "홍길동"]);
  });
});

