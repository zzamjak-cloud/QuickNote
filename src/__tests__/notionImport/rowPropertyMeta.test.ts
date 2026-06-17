import { describe, it, expect } from "vitest";
import { parseNotionRowProperties } from "../../lib/notionImport/rowPropertyMeta";
import { mapNotionPropertyType } from "../../lib/notionImport/columnInference";

// Notion 행 페이지의 properties 테이블 구조를 본뜬 픽스처.
// 메인 컬렉션 뷰에 노출되지 않는 숨은 컬럼(checkbox/select 등)의 타입·색이 여기서 복원된다.
const ROW_HTML = `
<article class="page">
  <table class="properties"><tbody>
    <tr class="property-row property-row-created_time"><th><span class="icon"><img/></span>생성일</th><td><time>2022년 6월 21일</time></td></tr>
    <tr class="property-row property-row-multi_select"><th>태그</th><td><span class="selected-value select-value-color-blue">Unity</span><span class="selected-value select-value-color-green">모듈</span></td></tr>
    <tr class="property-row property-row-checkbox"><th>완료</th><td><span class="checkbox checkbox-on"></span></td></tr>
    <tr class="property-row property-row-select"><th>진행상황</th><td><span class="selected-value select-value-color-green">완료</span></td></tr>
    <tr class="property-row property-row-person"><th>작업자</th><td><span class="user">최민철</span></td></tr>
  </tbody></table>
</article>`;

describe("parseNotionRowProperties", () => {
  it("properties 테이블에서 헤더·원본타입·옵션색을 추출한다", () => {
    const props = parseNotionRowProperties(ROW_HTML);
    const byHeader = new Map(props.map((p) => [p.header, p]));

    expect(byHeader.get("생성일")?.notionType).toBe("created_time");
    expect(byHeader.get("완료")?.notionType).toBe("checkbox");
    expect(byHeader.get("진행상황")?.notionType).toBe("select");
    expect(byHeader.get("작업자")?.notionType).toBe("person");

    expect(byHeader.get("태그")?.options).toEqual([
      { label: "Unity", colorToken: "blue" },
      { label: "모듈", colorToken: "green" },
    ]);
    expect(byHeader.get("진행상황")?.options).toEqual([
      { label: "완료", colorToken: "green" },
    ]);
  });

  it("default 색 토큰은 색 없음(null)으로 정규화한다", () => {
    const html = `<table class="properties"><tbody>
      <tr class="property-row property-row-select"><th>상태</th><td><span class="selected-value select-value-color-default">기본</span></td></tr>
    </tbody></table>`;
    expect(parseNotionRowProperties(html)[0]?.options).toEqual([
      { label: "기본", colorToken: null },
    ]);
  });

  it("properties 테이블이 없으면 빈 배열을 반환한다", () => {
    expect(parseNotionRowProperties("<article class='page'><p>본문</p></article>")).toEqual([]);
  });
});

describe("mapNotionPropertyType", () => {
  it("Notion 원본 타입을 QuickNote 컬럼 타입으로 매핑한다", () => {
    expect(mapNotionPropertyType("checkbox")).toBe("checkbox");
    expect(mapNotionPropertyType("select")).toBe("select");
    expect(mapNotionPropertyType("status")).toBe("status");
    expect(mapNotionPropertyType("multi_select")).toBe("multiSelect");
    expect(mapNotionPropertyType("created_time")).toBe("date");
    expect(mapNotionPropertyType("created_by")).toBe("person");
    expect(mapNotionPropertyType("last_edited_by")).toBe("person");
    expect(mapNotionPropertyType("phone_number")).toBe("phone");
  });

  it("매핑 불가 타입(formula/rollup 등)은 null 을 반환해 휴리스틱에 위임한다", () => {
    expect(mapNotionPropertyType("formula")).toBeNull();
    expect(mapNotionPropertyType("rollup")).toBeNull();
    expect(mapNotionPropertyType("")).toBeNull();
    expect(mapNotionPropertyType(null)).toBeNull();
  });
});
