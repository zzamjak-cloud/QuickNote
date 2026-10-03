// create_comment — 블록 댓글 작성(v5 upsertComment 경로: 작성자=토큰 소유 멤버 강제, 멘션 알림 생성).
// 댓글은 블록에 앵커된다. blockId 를 생략하면 본문 첫 블록(페이지 상단)에 단다.
// 저장 후 publishCommentChanged(IAM)로 onCommentChanged 구독 클라에 즉시 알린다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { upsertComment } from "../../v5-resolvers/handlers/commentDatabase";
import type { DocNode } from "../../../../src/lib/docModel/types";
import { loadBodyBase } from "../collabWriter";
import { ToolError, type McpContext } from "../context";
import { nowIso } from "../pageWrite";
import { publishComment } from "../publish";
import { loadWritablePage } from "../writeAccess";

export const createCommentInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page to comment on"),
  text: z.string().trim().min(1).max(10_000).describe("Comment text (plain text)"),
  blockId: z.string().trim().min(1).max(256).optional()
    .describe("Block id to anchor the comment (from get_comments or block ids); defaults to the first block of the page"),
};
const createCommentInput = z.object(createCommentInputShape);
export type CreateCommentInput = z.input<typeof createCommentInput>;

function blockIds(node: DocNode, out: string[] = []): string[] {
  const id = node.attrs?.id;
  if (node.type !== "doc" && typeof id === "string" && id) out.push(id);
  for (const child of node.content ?? []) blockIds(child, out);
  return out;
}

export async function createCommentTool(ctx: McpContext, raw: CreateCommentInput) {
  const input = createCommentInput.parse(raw);
  const page = await loadWritablePage(ctx, input.pageId);
  const base = await loadBodyBase(ctx, page);
  const ids = blockIds(base.doc as DocNode);
  const blockId = input.blockId ?? ids[0];
  if (!blockId) throw new ToolError("This page has no block to anchor a comment to; add content first");
  if (!ids.includes(blockId)) throw new ToolError(`Block ${blockId} was not found on this page`);
  const now = nowIso();
  const saved = await upsertComment({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: {
      id: randomUUID(),
      workspaceId: String(page.workspaceId),
      pageId: String(page.id),
      blockId,
      bodyText: input.text,
      mentionMemberIds: [],
      createdAt: now,
    },
  });
  await publishComment(saved);
  return { id: String(saved.id), pageId: String(page.id), blockId, createdAt: String(saved.createdAt) };
}
