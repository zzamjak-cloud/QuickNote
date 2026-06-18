import { describe, it, expect } from "vitest";
import {
  incomingDocLacksContent,
  isPlaceholderPageDoc,
  hasMeaningfulPageDocContent,
  preserveExistingDocForPlaceholderInput,
} from "../pageDatabase";

// 서버 최후 방어선: upsertRecord 는 전체 PutItem(전치환)이므로 본문 없는 입력이
// 기존 유의미 본문을 통째로 소거할 수 있다. 이 가드가 그 경로를 전부 막는지 고정한다.

const MEANINGFUL_DOC = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "실제 본문" }] }],
});
const PLACEHOLDER_DOC = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph" }],
});

describe("incomingDocLacksContent", () => {
  it("doc 키가 아예 없으면 본문 없음으로 본다(메타데이터-only 업서트)", () => {
    expect(incomingDocLacksContent({ id: "p1", title: "t" })).toBe(true);
  });

  it("doc 이 null/undefined/빈 문자열이면 본문 없음", () => {
    expect(incomingDocLacksContent({ doc: null })).toBe(true);
    expect(incomingDocLacksContent({ doc: undefined })).toBe(true);
    expect(incomingDocLacksContent({ doc: "" })).toBe(true);
    expect(incomingDocLacksContent({ doc: "   " })).toBe(true);
  });

  it("빈 문단만 있는 placeholder 도 본문 없음", () => {
    expect(incomingDocLacksContent({ doc: PLACEHOLDER_DOC })).toBe(true);
  });

  it("실제 본문이 있으면 본문 있음", () => {
    expect(incomingDocLacksContent({ doc: MEANINGFUL_DOC })).toBe(false);
  });
});

describe("preserveExistingDocForPlaceholderInput", () => {
  it("doc 키 누락 + 기존 유의미 본문 → 기존 본문을 다시 싣는다(소거 차단)", () => {
    const input: Record<string, unknown> = { id: "p1", title: "새 제목" };
    preserveExistingDocForPlaceholderInput(input, { id: "p1", doc: MEANINGFUL_DOC });
    expect(input.doc).toBe(MEANINGFUL_DOC);
  });

  it("doc=null + 기존 유의미 본문 → 보존", () => {
    const input: Record<string, unknown> = { id: "p1", doc: null };
    preserveExistingDocForPlaceholderInput(input, { id: "p1", doc: MEANINGFUL_DOC });
    expect(input.doc).toBe(MEANINGFUL_DOC);
  });

  it("placeholder + 기존 유의미 본문 → 보존", () => {
    const input: Record<string, unknown> = { id: "p1", doc: PLACEHOLDER_DOC };
    preserveExistingDocForPlaceholderInput(input, { id: "p1", doc: MEANINGFUL_DOC });
    expect(input.doc).toBe(MEANINGFUL_DOC);
  });

  it("실제 본문 입력은 그대로 저장(정상 편집 보존)", () => {
    const next = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "수정됨" }] }],
    });
    const input: Record<string, unknown> = { id: "p1", doc: next };
    preserveExistingDocForPlaceholderInput(input, { id: "p1", doc: MEANINGFUL_DOC });
    expect(input.doc).toBe(next);
  });

  it("신규 페이지(existing=null)는 빈 본문도 허용(의도적 빈 페이지)", () => {
    const input: Record<string, unknown> = { id: "p1", doc: PLACEHOLDER_DOC };
    preserveExistingDocForPlaceholderInput(input, null);
    expect(input.doc).toBe(PLACEHOLDER_DOC);
  });

  it("기존도 placeholder 면 입력 유지(보존할 본문 없음)", () => {
    const input: Record<string, unknown> = { id: "p1" };
    preserveExistingDocForPlaceholderInput(input, { id: "p1", doc: PLACEHOLDER_DOC });
    expect("doc" in input).toBe(false);
  });
});

describe("isPlaceholderPageDoc / hasMeaningfulPageDocContent 대칭성", () => {
  it("placeholder 는 meaningful 이 아니고, meaningful 은 placeholder 가 아니다", () => {
    expect(isPlaceholderPageDoc(PLACEHOLDER_DOC)).toBe(true);
    expect(hasMeaningfulPageDocContent(PLACEHOLDER_DOC)).toBe(false);
    expect(isPlaceholderPageDoc(MEANINGFUL_DOC)).toBe(false);
    expect(hasMeaningfulPageDocContent(MEANINGFUL_DOC)).toBe(true);
  });
});
