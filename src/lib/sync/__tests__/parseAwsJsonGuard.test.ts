import { describe, it, expect } from "vitest";
import { parseAwsJson } from "../storeApply/helpers";
import { DocEnvelopeSchema, DbCellsSchema } from "../schemas";

// 4.2 경계 envelope 가드: doc/cells shape 검증이 정상 데이터를 무손실로 통과시키되
// 깨진 모양(garbage)은 fallback 으로 떨구는지 확인한다.

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

describe("parseAwsJson + DocEnvelopeSchema", () => {
  it("정상 doc 은 한 글자도 버리지 않고 통과(passthrough)", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "안녕" }] }],
      attrs: { foo: 1 },
    };
    expect(parseAwsJson(JSON.stringify(doc), EMPTY_DOC, DocEnvelopeSchema)).toEqual(doc);
  });

  it("객체로 이미 풀린 doc 도 통과", () => {
    const doc = { type: "doc", content: [] };
    expect(parseAwsJson(doc, EMPTY_DOC, DocEnvelopeSchema)).toEqual(doc);
  });

  it("이중 인코딩 doc(restorePageVersion 응답)도 풀어서 통과", () => {
    // AWSJSON 이 직렬화 문자열을 한 번 더 감싼 형태: JSON.stringify(JSON.stringify(doc))
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "복원" }] }],
    };
    const doubleEncoded = JSON.stringify(JSON.stringify(doc));
    expect(parseAwsJson(doubleEncoded, EMPTY_DOC, DocEnvelopeSchema)).toEqual(doc);
  });

  it("type 없는 객체/배열/스칼라/깨진 JSON 은 fallback", () => {
    expect(parseAwsJson({ content: [] }, EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
    expect(parseAwsJson("[]", EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
    expect(parseAwsJson("42", EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
    expect(parseAwsJson("not json", EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
  });

  it("null/undefined 는 fallback", () => {
    expect(parseAwsJson(null, EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
    expect(parseAwsJson(undefined, EMPTY_DOC, DocEnvelopeSchema)).toBe(EMPTY_DOC);
  });
});

describe("parseAwsJson + DbCellsSchema", () => {
  it("정상 dbCells 객체는 무손실 통과", () => {
    const cells = { col1: "v", col2: ["a", "b"], _qn_isTemplate: "1" };
    expect(parseAwsJson(JSON.stringify(cells), undefined, DbCellsSchema)).toEqual(cells);
  });

  it("배열/스칼라는 fallback(undefined)", () => {
    expect(parseAwsJson("[]", undefined, DbCellsSchema)).toBeUndefined();
    expect(parseAwsJson("5", undefined, DbCellsSchema)).toBeUndefined();
    expect(parseAwsJson('"str"', undefined, DbCellsSchema)).toBeUndefined();
  });
});

describe("parseAwsJson schema 미지정 시 기존 동작 보존", () => {
  it("문자열 JSON 파싱", () => {
    expect(parseAwsJson('{"a":1}', null)).toEqual({ a: 1 });
  });
  it("깨진 JSON 은 fallback", () => {
    expect(parseAwsJson("oops", "fb")).toBe("fb");
  });
});
