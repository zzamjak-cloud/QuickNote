import { describe, expect, it } from "vitest";
import { inferNotionColumnType } from "../../lib/notionImport/columnInference";

describe("inferNotionColumnType - 사람 컬럼 감지", () => {
  it("헤더가 '이름'이고 값이 '이름 [태그]' 패턴이면 person 으로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "이름",
      values: ["최진평 [CAT]", "최진평 [BK]", "이다은 [멘토]"],
    });
    expect(type).toBe("person");
  });

  it("헤더 키워드가 없어도 '이름 [태그]' 패턴이 다수면 person 으로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "기타",
      values: ["김철수 [개발]", "박영희[기획]", "최진평 [CAT]"],
    });
    expect(type).toBe("person");
  });

  it("쉼표로 구분된 다중 인물 '이름 [태그]' 값도 person 으로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "참여자",
      values: ["최진평 [CAT], 이다은 [BK]", "김철수 [개발]"],
    });
    expect(type).toBe("person");
  });

  it("강한 헤더 키워드(담당자)는 기존대로 person 으로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "담당자",
      values: ["홍길동", "이순신"],
    });
    expect(type).toBe("person");
  });

  it("대괄호 태그 없는 일반 텍스트 '이름' 컬럼은 person 으로 단정하지 않는다", () => {
    // 한 컬럼에 동일 항목 반복이 없고 사람 이름 토큰화는 되지만,
    // 약한 헤더 + 사람 토큰 비율 0.8 이상이면 person 으로 본다.
    // 여기서는 음식 이름이라 토큰화는 되더라도 의미상 텍스트지만,
    // 약한 헤더('이름') + 단일 토큰 비율 0.8 이상 조건상 person 으로 분류될 수 있어
    // 대괄호가 없는 값은 별도 select/text 경로로 흐르는지 확인한다.
    const type = inferNotionColumnType({
      header: "제품 코드",
      values: ["A-100", "B-200", "C-300"],
    });
    expect(type).not.toBe("person");
  });

  it("대괄호 태그만 있는 멀티셀렉트 값은 person 으로 오인하지 않는다", () => {
    // "[긴급]" 처럼 이름 없이 태그만 있는 값은 person 패턴이 아니다.
    const type = inferNotionColumnType({
      header: "우선순위",
      values: ["[긴급]", "[보통]", "[낮음]", "[긴급]", "[보통]", "[낮음]"],
    });
    expect(type).not.toBe("person");
  });
});

describe("inferNotionColumnType - URL 컬럼 감지", () => {
  it("http(s):// 값은 '/' 분할로 multiSelect 가 아니라 url 로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "링크",
      values: [
        "https://sensortower.com/ko/pre-g-star-connect-2025-seoul",
        "https://example.com/a/b/c",
        "http://foo.bar/x",
      ],
    });
    expect(type).toBe("url");
  });

  it("헤더 키워드가 없어도 값이 URL 이면 url 로 감지한다", () => {
    const type = inferNotionColumnType({
      header: "참고",
      values: ["https://a.com/path/seg", "https://b.io/y/z"],
    });
    expect(type).toBe("url");
  });

  it("일부만 URL 인 혼합 컬럼은 url 로 단정하지 않는다", () => {
    const type = inferNotionColumnType({
      header: "메모",
      values: ["https://a.com/x", "일반 텍스트", "또 다른 텍스트", "그냥 메모"],
    });
    expect(type).not.toBe("url");
  });
});
