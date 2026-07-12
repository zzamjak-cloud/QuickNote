// 요약 캐시 지문 — 총 길이가 같은 중간 편집도 다른 해시가 나와야 stale 요약을 막는다.
import { describe, expect, it } from "vitest";
import { buildSummaryCacheKey, hashAiContextMarkdown } from "../summaryCache";

describe("hashAiContextMarkdown", () => {
  it("동일 본문은 동일 해시", () => {
    const md = "# 제목\n\n본문 내용입니다.";
    expect(hashAiContextMarkdown(md)).toBe(hashAiContextMarkdown(md));
  });

  it("총 길이가 같은 중간 편집을 구분한다 (양끝 64자 바깥)", () => {
    const pad = "x".repeat(100);
    const a = `${pad}중간 단어 AAAA${pad}`;
    const b = `${pad}중간 단어 BBBB${pad}`;
    expect(a.length).toBe(b.length);
    expect(hashAiContextMarkdown(a)).not.toBe(hashAiContextMarkdown(b));
  });

  it("빈 문자열도 안정적으로 처리", () => {
    expect(hashAiContextMarkdown("")).toBe(hashAiContextMarkdown(""));
  });
});

describe("buildSummaryCacheKey", () => {
  it("페이지·DB·모델별로 키가 구분된다", () => {
    const base = { workspaceId: "ws1", contentHash: "h1", model: "gemini-2.5-flash" };
    const pageKey = buildSummaryCacheKey({ ...base, pageId: "p1" });
    const dbKey = buildSummaryCacheKey({ ...base, databaseId: "d1" });
    const otherModel = buildSummaryCacheKey({ ...base, pageId: "p1", model: "claude-haiku-4-5" });
    expect(new Set([pageKey, dbKey, otherModel]).size).toBe(3);
  });
});
