import { describe, it, expect } from "vitest";
import type { Page } from "../../../types/page";
import { extractPageSearchRecord } from "../extractPageText";
import { buildSnippetFromText, findBestSnippet } from "../buildSnippet";
import { koreanMatchRange, koreanMatchOffset } from "../../koreanSearch";

function makePage(partial: Partial<Page>): Page {
  return {
    id: "p1",
    title: "제목",
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as Page;
}

describe("extractPageSearchRecord", () => {
  it("top-level 블록을 순서대로 분해하고 빈 블록은 건너뛴다", () => {
    const page = makePage({
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "첫 문단" }] },
          { type: "paragraph" }, // 빈 블록
          {
            type: "heading",
            attrs: { id: "blk-2", level: 2 },
            content: [{ type: "text", text: "둘째 헤딩" }],
          },
        ],
      },
    });
    const rec = extractPageSearchRecord(page);
    expect(rec.blocks).toHaveLength(2);
    expect(rec.blocks[0]).toMatchObject({ blockIndex: 0, blockId: null, text: "첫 문단" });
    expect(rec.blocks[1]).toMatchObject({ blockIndex: 2, blockId: "blk-2", text: "둘째 헤딩" });
  });

  it("DB 행 셀 값도 검색 가능한 블록으로 붙인다", () => {
    const page = makePage({
      databaseId: "db1",
      doc: { type: "doc", content: [] },
      dbCells: { col1: "담당자 홍길동", col2: ["태그A", "태그B"] },
    });
    const rec = extractPageSearchRecord(page);
    expect(rec.kind).toBe("db-row");
    const texts = rec.blocks.map((b) => b.text);
    expect(texts).toContain("담당자 홍길동");
    expect(texts).toContain("태그A 태그B");
  });
});

describe("koreanMatchRange / koreanMatchOffset", () => {
  it("직접 포함 매치의 위치와 길이를 반환한다", () => {
    expect(koreanMatchRange("hello world", "world")).toEqual({ index: 6, length: 5 });
    expect(koreanMatchOffset("hello world", "zzz")).toBe(-1);
  });

  it("영문 자모 입력을 한글로 변환해 매치한다", () => {
    // rkskek -> 가나다
    const r = koreanMatchRange("가나다라마", "rkskek");
    expect(r).not.toBeNull();
    expect(r?.index).toBe(0);
  });
});

describe("buildSnippetFromText", () => {
  it("키워드 주변 컨텍스트를 잘라 match 를 분리한다", () => {
    const text = "이 문서는 프로젝트 일정과 예산을 다룬다";
    const s = buildSnippetFromText(text, "예산");
    expect(s).not.toBeNull();
    expect(s?.match).toBe("예산");
    expect(`${s?.before}${s?.match}${s?.after}`).toContain("예산");
  });

  it("매치가 없으면 null", () => {
    expect(buildSnippetFromText("내용 없음", "존재하지않는키워드")).toBeNull();
  });

  it("긴 본문 앞쪽을 말줄임표로 자른다", () => {
    const text = "가".repeat(100) + "찾을말";
    const s = buildSnippetFromText(text, "찾을말");
    expect(s?.before.startsWith("…")).toBe(true);
    expect(s?.match).toBe("찾을말");
  });
});

describe("findBestSnippet", () => {
  it("매치되는 첫 블록의 스니펫과 blockRef 를 반환한다", () => {
    const hit = findBestSnippet(
      [
        { blockIndex: 0, blockId: null, text: "관계 없는 텍스트" },
        { blockIndex: 1, blockId: "b1", text: "여기에 키워드 포함" },
      ],
      "키워드",
    );
    expect(hit?.blockRef).toEqual({ blockId: "b1", blockIndex: 1 });
    expect(hit?.snippet.match).toBe("키워드");
  });
});
