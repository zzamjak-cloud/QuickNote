import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { pageDocToHtml } from "../pageToHtml";
import { notionHtmlToDoc, type NotionCollectionTable } from "../../notionImport/htmlToDoc";

// databaseBlock 노드 하나만 가진 doc 으로 export → import 라운드트립을 검증한다.
function makeDbDoc(): JSONContent {
  return {
    type: "doc",
    content: [{ type: "databaseBlock", attrs: { databaseId: "db-1" } }],
  };
}

describe("collection 표 export ↔ htmlToDoc 라운드트립", () => {
  it("resolveCollection 으로 만든 collection-content 표가 onCollectionTable 로 그대로 들어온다", () => {
    const headers = ["이름", "수량", "메모"];
    const rows = [
      ["행 하나", "3", "첫 메모"],
      ["행 둘", "7", "둘째 메모"],
    ];

    const html = pageDocToHtml("테스트", makeDbDoc(), {
      resolveCollection: (id) => (id === "db-1" ? { headers, rows } : null),
    });

    // 본문만 article.page 로 감싸 파서에 전달(제목 h1 제거).
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
    const bodyInner = bodyMatch?.[1] ?? "";
    const withoutTitle = bodyInner.replace(/<h1>[\s\S]*?<\/h1>/i, "");

    let captured: NotionCollectionTable | null = null;
    notionHtmlToDoc(`<html><body><article class="page">${withoutTitle}</article></body></html>`, {
      onCollectionTable: (table) => {
        captured = table;
        return "db-1"; // databaseId 반환 → databaseBlock 생성
      },
    });

    expect(captured).not.toBeNull();
    const table = captured as unknown as NotionCollectionTable;
    expect(table.headers).toEqual(headers);
    expect(table.rows.map((r) => r.cells)).toEqual(rows);
  });
});
