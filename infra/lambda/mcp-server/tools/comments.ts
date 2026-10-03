// get_comments — 페이지 블록 댓글. Comments 테이블(워크스페이스 GSI + pageId 필터)이 주 소스이고,
// 구버전 클라가 Page.blockComments 에만 남긴 메시지는 id 중복 제거 후 합친다.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { NOT_ACCESSIBLE, requireWorkspace } from "../access";
import { ToolError, type McpContext } from "../context";
import { getItem } from "../ddb";
import { loadMemberNames } from "../properties";

export const getCommentsInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page id whose block comments to read"),
};
const getCommentsInput = z.object(getCommentsInputShape);
export type GetCommentsInput = z.input<typeof getCommentsInput>;

/** 워크스페이스 댓글 GSI 를 읽는 상한(필터 전 항목 수). */
export const MAX_SCANNED_COMMENTS = 5000;
const MAX_RETURNED_COMMENTS = 500;

type CommentOut = {
  id: string;
  blockId: string;
  parentId: string | null;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
};

type Raw = Record<string, unknown>;

function toIso(value: unknown): string {
  if (typeof value === "number") return new Date(value).toISOString();
  return typeof value === "string" ? value : "";
}

/**
 * 페이지 댓글 — byPageId GSI(pageId) 로 그 페이지만 읽는다. 다른 워크스페이스 항목은 버린다
 * (pageId 충돌 방어). 인덱스가 아직 없거나 백필 중이면 워크스페이스 GSI 스캔으로 폴백한다.
 */
async function queryCommentsByPage(ctx: McpContext, workspaceId: string, pageId: string) {
  const items: Raw[] = [];
  let lastKey: Raw | undefined;
  do {
    const r = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tables.Comments,
        IndexName: "byPageId",
        KeyConditionExpression: "pageId = :p",
        ExpressionAttributeValues: { ":p": pageId },
        Limit: 500,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((r.Items ?? []) as Raw[]).filter((c) => c.workspaceId === workspaceId));
    lastKey = r.LastEvaluatedKey as Raw | undefined;
  } while (lastKey && items.length < MAX_SCANNED_COMMENTS);
  return { items, truncated: Boolean(lastKey) };
}

function isMissingIndex(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === "ValidationException" || e?.name === "ResourceNotFoundException" || /index/i.test(e?.message ?? "");
}

async function queryTableComments(ctx: McpContext, workspaceId: string, pageId: string) {
  try {
    return await queryCommentsByPage(ctx, workspaceId, pageId);
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    console.warn("mcp get_comments byPageId 미사용(폴백)", (err as Error)?.name);
    return queryCommentsByWorkspace(ctx, workspaceId, pageId);
  }
}

async function queryCommentsByWorkspace(ctx: McpContext, workspaceId: string, pageId: string) {
  const items: Raw[] = [];
  let scanned = 0;
  let lastKey: Raw | undefined;
  do {
    const r = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tables.Comments,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        FilterExpression: "pageId = :p",
        ExpressionAttributeValues: { ":w": workspaceId, ":p": pageId },
        Limit: Math.min(1000, MAX_SCANNED_COMMENTS - scanned),
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((r.Items ?? []) as Raw[]));
    scanned += r.ScannedCount ?? r.Items?.length ?? 0;
    lastKey = r.LastEvaluatedKey as Raw | undefined;
  } while (lastKey && scanned < MAX_SCANNED_COMMENTS);
  return { items, truncated: Boolean(lastKey) };
}

function legacyMessages(page: Raw): Raw[] {
  let snapshot = page.blockComments;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      return [];
    }
  }
  const messages = (snapshot as { messages?: unknown } | null)?.messages;
  return Array.isArray(messages) ? (messages as Raw[]) : [];
}

export async function getCommentsTool(ctx: McpContext, raw: GetCommentsInput) {
  const input = getCommentsInput.parse(raw);
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: input.pageId });
  if (!page) throw new ToolError(NOT_ACCESSIBLE);
  const workspaceId = String(page.workspaceId ?? "");
  await requireWorkspace(ctx, workspaceId);

  const table = await queryTableComments(ctx, workspaceId, input.pageId);
  const byId = new Map<string, Raw>();
  for (const m of legacyMessages(page)) if (typeof m.id === "string") byId.set(m.id, m);
  for (const c of table.items) if (typeof c.id === "string") byId.set(c.id, c);
  const live = [...byId.values()]
    .filter((c) => !c.deletedAt)
    .sort((a, b) => toIso(a.createdAt).localeCompare(toIso(b.createdAt)))
    .slice(0, MAX_RETURNED_COMMENTS);

  const names = await loadMemberNames(
    ctx.doc,
    ctx.tables.Members,
    live.map((c) => String(c.authorMemberId ?? "")),
  );
  const comments: CommentOut[] = live.map((c) => ({
    id: String(c.id),
    blockId: String(c.blockId ?? ""),
    parentId: typeof c.parentId === "string" && c.parentId ? c.parentId : null,
    authorId: String(c.authorMemberId ?? ""),
    author: names.get(String(c.authorMemberId ?? "")) ?? String(c.authorMemberId ?? ""),
    body: String(c.bodyText ?? ""),
    createdAt: toIso(c.createdAt),
  }));
  return { pageId: input.pageId, comments, truncated: table.truncated };
}
