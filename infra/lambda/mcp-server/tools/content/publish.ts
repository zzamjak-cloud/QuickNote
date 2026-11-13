// 웹 게시 — v5 publishedPage 핸들러(토큰 = capability, 공개 스냅샷 생성)를 그대로 쓴다.
// MCP 인가(토큰 범위·MCP 정책·edit)를 먼저 통과시킨 뒤 핸들러가 워크스페이스 권한을 한 번 더 검사한다.
import { z } from "zod";
import {
  getPagePublishStatus,
  publishPage,
  unpublishPage,
  type PagePublishStatusGql,
} from "../../../v5-resolvers/handlers/publishedPage";
import type { McpContext } from "../../context";
import { loadWritablePage } from "../../writeAccess";
import { loadPageAnyState } from "../history/shared";
import { contentTables, idInput, publicPageUrl, requireConfigured } from "./shared";

export const publishPageInputShape = { pageId: idInput.describe("Page to publish to the web (with its child pages). Database rows cannot be published") };
const publishPageInput = z.object(publishPageInputShape);

function handlerArgs(ctx: McpContext, pageId: string) {
  const tables = contentTables(ctx);
  requireConfigured(tables.PublishedPages, "Web publishing");
  return { doc: ctx.doc, tables, caller: ctx.caller, pageId };
}

function toResult(status: PagePublishStatusGql) {
  return {
    pageId: status.pageId,
    published: status.published,
    url: status.token ? publicPageUrl(status.token) : null,
    publishedAt: status.publishedAt,
  };
}

/** 이미 게시돼 있으면 같은 링크를 유지하고 공개 스냅샷만 최신 본문으로 갱신한다(앱 재게시와 같다). */
export async function publishPageTool(ctx: McpContext, raw: z.input<typeof publishPageInput>) {
  const input = publishPageInput.parse(raw);
  await loadWritablePage(ctx, input.pageId);
  return toResult(await publishPage(handlerArgs(ctx, input.pageId)));
}

export const unpublishPageInputShape = { pageId: idInput.describe("Published page (trashed pages allowed)") };
const unpublishPageInput = z.object(unpublishPageInputShape);

/** 모든 공개 링크를 폐기한다. 다시 게시하면 새 링크가 발급된다. */
export async function unpublishPageTool(ctx: McpContext, raw: z.input<typeof unpublishPageInput>) {
  const input = unpublishPageInput.parse(raw);
  await loadPageAnyState(ctx, input.pageId, "write");
  return toResult(await unpublishPage(handlerArgs(ctx, input.pageId)));
}

export const getPublishStatusInputShape = { pageId: idInput };
const getPublishStatusInput = z.object(getPublishStatusInputShape);

export async function getPublishStatusTool(ctx: McpContext, raw: z.input<typeof getPublishStatusInput>) {
  const input = getPublishStatusInput.parse(raw);
  await loadPageAnyState(ctx, input.pageId, "read");
  return toResult(await getPagePublishStatus(handlerArgs(ctx, input.pageId)));
}
