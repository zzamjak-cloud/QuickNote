// create_comment — 블록 댓글 작성(v5 upsertComment 경로: 작성자=토큰 소유 멤버 강제, 멘션 알림 생성).
// 댓글은 블록에 앵커된다. blockId 를 생략하면 본문 첫 블록(페이지 상단)에 단다.
// parentId 를 주면 그 댓글 스레드의 답글로 단다(앵커는 부모 블록, 답글의 답글은 스레드 루트로 정규화).
// 저장 후 publishCommentChanged(IAM)로 onCommentChanged 구독 클라에 즉시 알린다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { upsertComment } from "../../v5-resolvers/handlers/commentDatabase";
import type { DocNode } from "../../../../src/lib/docModel/types";
import { loadBodyBase } from "../collabWriter";
import { NOT_ACCESSIBLE } from "../access";
import { ToolError, type McpContext } from "../context";
import { getItem } from "../ddb";
import { nowIso } from "../pageWrite";
import { publishComment } from "../publish";
import { loadWritablePage } from "../writeAccess";

export const createCommentInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page to comment on"),
  text: z.string().trim().min(1).max(10_000).describe("Comment text (plain text)"),
  blockId: z.string().trim().min(1).max(256).optional()
    .describe("Block id to anchor the comment (from get_comments or block ids); defaults to the first block of the page"),
  parentId: z.string().trim().min(1).max(256).optional()
    .describe("Reply to this comment (id from get_comments); the reply joins that thread and blockId is ignored"),
};
const createCommentInput = z.object(createCommentInputShape);
export type CreateCommentInput = z.input<typeof createCommentInput>;

function blockIds(node: DocNode, out: string[] = []): string[] {
  const id = node.attrs?.id;
  if (node.type !== "doc" && typeof id === "string" && id) out.push(id);
  for (const child of node.content ?? []) blockIds(child, out);
  return out;
}

type Thread = { parentId: string; blockId: string };

/** 답글 대상 — 같은 페이지의 살아 있는 댓글. 앱 스레드는 1단계라 부모가 답글이면 그 루트로 단다. */
async function replyThread(ctx: McpContext, pageId: string, parentId: string): Promise<Thread> {
  const parent = await getItem(ctx.doc, ctx.tables.Comments, { id: parentId });
  if (!parent || parent.deletedAt || parent.pageId !== pageId) throw new ToolError(`Comment ${parentId} ${NOT_ACCESSIBLE.toLowerCase()} on this page`);
  const rootId = typeof parent.parentId === "string" && parent.parentId ? parent.parentId : String(parent.id);
  return { parentId: rootId, blockId: String(parent.blockId) };
}

async function anchorBlock(ctx: McpContext, page: Record<string, unknown>, requested: string | undefined): Promise<string> {
  const base = await loadBodyBase(ctx, page);
  const ids = blockIds(base.doc as DocNode);
  const blockId = requested ?? ids[0];
  if (!blockId) throw new ToolError("This page has no block to anchor a comment to; add content first");
  if (!ids.includes(blockId)) throw new ToolError(`Block ${blockId} was not found on this page`);
  return blockId;
}

export async function createCommentTool(ctx: McpContext, raw: CreateCommentInput) {
  const input = createCommentInput.parse(raw);
  const page = await loadWritablePage(ctx, input.pageId);
  const thread = input.parentId ? await replyThread(ctx, String(page.id), input.parentId) : null;
  const blockId = thread?.blockId ?? await anchorBlock(ctx, page, input.blockId);
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
      parentId: thread?.parentId ?? null,
      createdAt: now,
    },
  });
  await publishComment(saved);
  return {
    id: String(saved.id), pageId: String(page.id), blockId,
    ...(thread ? { parentId: thread.parentId } : {}),
    createdAt: String(saved.createdAt),
  };
}
