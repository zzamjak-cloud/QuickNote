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

  // 크래시 패밀리 회귀: name/email 은 타입상 string 이지만 런타임에 nullish 가 올 수 있다
  // (초대 후 미온보딩 멤버 등). 무가드 문자열 메서드 호출이 앱을 죽이지 않아야 한다.
  it("name/email 이 없어도 검색이 크래시하지 않는다", () => {
    const member = { name: undefined, email: null } as unknown as {
      name: string;
      email?: string | null;
    };
    expect(() => matchesMemberSearchQuery(member, "aaa")).not.toThrow();
    expect(matchesMemberSearchQuery(member, "aaa")).toBe(false);
    expect(matchesMemberSearchQuery(member, "ㅎㄱ")).toBe(false);
  });

  it("name 이 없는 항목이 섞여도 정렬이 크래시하지 않는다", () => {
    const sorted = sortByKoreanName([
      { name: "홍길동", id: "2" },
      { name: undefined as unknown as string, id: "1" },
    ]);
    expect(sorted).toHaveLength(2);
  });
});

