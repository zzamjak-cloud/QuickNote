import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishOnlyResult } from "../../v5-resolvers/index";
import { publishComment, publishDatabase, publishPage } from "../publish";

const posted: { query: string; variables: Record<string, unknown> }[] = [];
vi.mock("../../_shared/appsyncIam", () => ({
  postAppSyncIam: vi.fn(async (query: string, variables: Record<string, unknown>) => {
    if (query.includes("boom")) throw new Error("x");
    posted.push({ query, variables });
  }),
}));


beforeEach(() => {
  posted.length = 0;
});

describe("publish*Changed", () => {
  it("페이지는 메타만(본문·셀 placeholder) 싣고 deletedAt 을 tombstone 인자로 보낸다", async () => {
    const ok = await publishPage(
      { id: "p1", workspaceId: "w", createdByMemberId: "m", title: "T", titleColor: "#f00", order: "1", doc: '{"big":true}', dbCells: '{"a":1}', createdAt: "c", updatedAt: "u" },
      { deletedAt: "2026-10-03T00:00:00.000Z" },
    );
    expect(ok).toBe(true);
    const { variables, query } = posted[0];
    expect(query).toContain("publishPageChanged(input: $input, deletedAt: $deletedAt)");
    expect(variables.deletedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(String((variables.input as Record<string, unknown>).doc)).not.toContain("big");
    expect((variables.input as Record<string, unknown>).dbCells).toBeNull();
    // titleColor 가 빠지면 echo 결과로 수신 클라의 제목 색이 지워진다.
    expect((variables.input as Record<string, unknown>).titleColor).toBe("#f00");
  });

  it("DB·댓글 발행 입력은 AWSJSON 문자열로 정규화", async () => {
    await publishDatabase({ id: "d", workspaceId: "w", title: "T", columns: [{ id: "c" }], createdAt: "c", updatedAt: "u" });
    await publishComment({ id: "c1", workspaceId: "w", pageId: "p", blockId: "b", authorMemberId: "m", bodyText: "hi", mentionMemberIds: [], createdAt: "c", updatedAt: "u" });
    expect((posted[0].variables.input as Record<string, unknown>).columns).toBe('[{"id":"c"}]');
    expect((posted[1].variables.input as Record<string, unknown>).mentionMemberIds).toBe("[]");
  });
});

describe("v5 publishOnlyResult(IAM echo)", () => {
  it("페이지 deletedAt 인자를 싣고, DB·댓글은 입력 echo(가져오기 작성자 필드 제거)", () => {
    expect(publishOnlyResult("publishPageChanged", { input: { id: "p" }, deletedAt: "d" })).toEqual({ id: "p", deletedAt: "d" });
    expect(publishOnlyResult("publishPageChanged", { input: { id: "p" } })).toEqual({ id: "p" });
    expect(publishOnlyResult("publishDatabaseChanged", { input: { id: "d" } })).toEqual({ id: "d", deletedAt: null });
    expect(publishOnlyResult("publishCommentChanged", { input: { id: "c", importedAuthorMemberId: "x" } })).toEqual({ id: "c", deletedAt: null });
    expect(publishOnlyResult("upsertPage", { input: { id: "p" } })).toBeNull();
  });
});
