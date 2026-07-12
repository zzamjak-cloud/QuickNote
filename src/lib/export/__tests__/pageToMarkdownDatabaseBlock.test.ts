// databaseBlock 렌더러 옵션 — AI 컨텍스트에서 인라인 DB 를 표/마커로 직렬화하기 위한 훅.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { pageDocToMarkdown } from "../pageToMarkdown";

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "본문 앞" }] },
    {
      type: "databaseBlock",
      attrs: { databaseId: "db-1", panelState: "{}" },
    },
    { type: "paragraph", content: [{ type: "text", text: "본문 뒤" }] },
  ],
};

describe("pageDocToMarkdown databaseBlock 렌더러", () => {
  it("옵션 미지정 시 기존처럼 생략된다 (export 경로 무변화)", () => {
    const md = pageDocToMarkdown(doc);
    expect(md).toContain("본문 앞");
    expect(md).toContain("본문 뒤");
    expect(md).not.toContain("db-1");
  });

  it("렌더러 지정 시 결과가 문서 순서 위치에 삽입된다", () => {
    const md = pageDocToMarkdown(doc, {
      renderDatabaseBlock: ({ databaseId }) => `[DB:${databaseId}]`,
    });
    const front = md.indexOf("본문 앞");
    const marker = md.indexOf("[DB:db-1]");
    const back = md.indexOf("본문 뒤");
    expect(front).toBeGreaterThanOrEqual(0);
    expect(marker).toBeGreaterThan(front);
    expect(back).toBeGreaterThan(marker);
  });

  it("렌더러가 빈 문자열을 반환하면 삽입하지 않는다", () => {
    const md = pageDocToMarkdown(doc, { renderDatabaseBlock: () => "" });
    expect(md).not.toContain("[DB:");
  });

  it("호출이 끝나면 옵션이 남지 않는다 (다음 호출 오염 방지)", () => {
    pageDocToMarkdown(doc, { renderDatabaseBlock: () => "[X]" });
    expect(pageDocToMarkdown(doc)).not.toContain("[X]");
  });
});
