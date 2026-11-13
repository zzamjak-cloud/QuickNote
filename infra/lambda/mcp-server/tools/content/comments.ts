// 댓글 수정·삭제·리액션 — v5 commentDatabase 핸들러 경로 + publishCommentChanged 로 열린 클라에 즉시 반영.
// 수정·삭제는 작성자 본인 댓글만(외부 AI 가 다른 사람 댓글을 바꾸지 않게), 리액션은 쓰기 가능한 워크스페이스면 누구나.
import { z } from "zod";
import {
  softDeleteComment,
  toggleCommentReaction,
  upsertComment,
} from "../../../v5-resolvers/handlers/commentDatabase";
import { NOT_ACCESSIBLE } from "../../access";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { nowIso } from "../../pageWrite";
import { publishComment } from "../../publish";
import { requireWritableWorkspace, requireWriteScope } from "../../writeAccess";
import { idInput } from "./shared";

type Item = Record<string, unknown>;

export const AUTHOR_ONLY_ERROR = "Only the author can edit or delete this comment";

/** 살아 있는(삭제 안 된) 댓글 + 쓰기 인가. 없음·권한 없음은 같은 문구로 숨긴다. */
export async function loadWritableComment(ctx: McpContext, commentId: string): Promise<Item> {
  requireWriteScope(ctx);
  const comment = await getItem(ctx.doc, ctx.tables.Comments, { id: commentId });
  if (!comment || comment.deletedAt) throw new ToolError(NOT_ACCESSIBLE);
  await requireWritableWorkspace(ctx, String(comment.workspaceId ?? ""));
  return comment;
}

function requireAuthor(ctx: McpContext, comment: Item): void {
  if (comment.authorMemberId !== ctx.caller.memberId) throw new ToolError(AUTHOR_ONLY_ERROR);
}

export const updateCommentInputShape = {
  commentId: idInput,
  text: z.string().trim().min(1).max(10_000).describe("New comment text (plain text)"),
};
const updateCommentInput = z.object(updateCommentInputShape);

export async function updateCommentTool(ctx: McpContext, raw: z.input<typeof updateCommentInput>) {
  const input = updateCommentInput.parse(raw);
  const comment = await loadWritableComment(ctx, input.commentId);
  requireAuthor(ctx, comment);
  // upsertComment 는 전체 Put 이라 앵커·스레드·멘션·리액션·작성 시각을 그대로 넘긴다.
  const saved = await upsertComment({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: {
      id: comment.id,
      workspaceId: comment.workspaceId,
      pageId: comment.pageId,
      blockId: comment.blockId,
      bodyText: input.text,
      mentionMemberIds: comment.mentionMemberIds ?? [],
      reactions: comment.reactions ?? [],
      parentId: comment.parentId ?? null,
      createdAt: comment.createdAt,
      updatedAt: nowIso(),
    },
  });
  await publishComment(saved);
  return { id: String(saved.id), pageId: String(saved.pageId), updatedAt: String(saved.updatedAt) };
}

export const deleteCommentInputShape = { commentId: idInput };
const deleteCommentInput = z.object(deleteCommentInputShape);

export async function deleteCommentTool(ctx: McpContext, raw: z.input<typeof deleteCommentInput>) {
  const input = deleteCommentInput.parse(raw);
  const comment = await loadWritableComment(ctx, input.commentId);
  requireAuthor(ctx, comment);
  const saved = await softDeleteComment({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    id: String(comment.id),
    workspaceId: String(comment.workspaceId),
    updatedAt: nowIso(),
  });
  const deletedAt = String(saved.deletedAt ?? nowIso());
  await publishComment({ ...comment, ...saved }, { deletedAt });
  return { id: String(comment.id), deleted: true, deletedAt };
}

export const toggleCommentReactionInputShape = {
  commentId: idInput,
  emoji: z.string().trim().min(1).max(64).describe("Emoji (e.g. 👍) — or a custom icon id when kind is custom"),
  kind: z.enum(["emoji", "custom"]).optional().describe("Default emoji"),
  reacted: z.boolean().optional().describe("true = add your reaction, false = remove it; omit to toggle"),
};
const toggleCommentReactionInput = z.object(toggleCommentReactionInputShape);

function hasReacted(reactions: unknown, kind: string, value: string, memberId: string): boolean {
  let list: unknown = reactions;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return false;
    }
  }
  if (!Array.isArray(list)) return false;
  return list.some((r) => {
    const rec = r as Item;
    return rec?.kind === kind && rec.value === value && Array.isArray(rec.memberIds) && rec.memberIds.includes(memberId);
  });
}

export async function toggleCommentReactionTool(ctx: McpContext, raw: z.input<typeof toggleCommentReactionInput>) {
  const input = toggleCommentReactionInput.parse(raw);
  const comment = await loadWritableComment(ctx, input.commentId);
  const kind = input.kind ?? "emoji";
  const reacted = input.reacted ?? !hasReacted(comment.reactions, kind, input.emoji, ctx.caller.memberId);
  const saved = await toggleCommentReaction({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: { id: comment.id, workspaceId: comment.workspaceId, reactionKind: kind, reactionValue: input.emoji, reacted },
  });
  await publishComment(saved);
  return { id: String(saved.id), reacted, reactions: typeof saved.reactions === "string" ? JSON.parse(saved.reactions) : saved.reactions };
}
