// 영구 삭제 — 되돌릴 수 없으므로 confirm: true 필수, 휴지통에 있는 대상만 허용한다.
// resolver(permanentlyDeletePage·permanentlyDeleteDatabase·emptyTrash)의 자체 보호(스케줄러 DB 거부·워크스페이스 일치·
// 휴지통 상태 확인)는 그대로 거친다. 휴지통 대상은 이미 tombstone 이 발행돼 열린 클라 목록에 없으므로 추가 발행은 없다.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  emptyTrash,
  permanentlyDeleteDatabase,
  permanentlyDeletePage,
} from "../../../v5-resolvers/handlers/pageDatabase/trash";
import { ToolError, type McpContext } from "../../context";
import { invalidateWorkspaceMetas } from "../../pageScan";
import { beginWrite } from "../../writeAccess";
import { databaseRowPages } from "./trash";
import { confirmInput, idInput, isTrashed, loadDatabaseAnyState, loadPageAnyState, requireConfirm, requireWorkspaceFor } from "./shared";

type Item = Record<string, unknown>;

export const permanentlyDeletePageInputShape = {
  pageId: idInput.describe("Trashed page id (see list_trash). Only this page; trashed children stay in the trash"),
  confirm: confirmInput,
};
const permanentlyDeletePageInput = z.object(permanentlyDeletePageInputShape);

export async function permanentlyDeletePageTool(ctx: McpContext, raw: z.input<typeof permanentlyDeletePageInput>) {
  const input = permanentlyDeletePageInput.parse(raw);
  requireConfirm(input.confirm);
  const page = await loadPageAnyState(ctx, input.pageId, "write");
  if (!isTrashed(page)) throw new ToolError("Only pages in the trash can be permanently deleted; use trash_page first");
  const workspaceId = String(page.workspaceId);
  await beginWrite(ctx, 1);
  await permanentlyDeletePage({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, id: input.pageId, workspaceId });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, workspaceId);
  return { deleted: input.pageId, permanent: true };
}

export const permanentlyDeleteDatabaseInputShape = {
  databaseId: idInput.describe("Trashed database id (see list_trash). Also deletes all its row pages"),
  confirm: confirmInput,
};
const permanentlyDeleteDatabaseInput = z.object(permanentlyDeleteDatabaseInputShape);

export async function permanentlyDeleteDatabaseTool(ctx: McpContext, raw: z.input<typeof permanentlyDeleteDatabaseInput>) {
  const input = permanentlyDeleteDatabaseInput.parse(raw);
  requireConfirm(input.confirm);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "write");
  if (!isTrashed(db)) throw new ToolError("Only databases in the trash can be permanently deleted; use trash_database first");
  const workspaceId = String(db.workspaceId);
  // DB 1 + 함께 영구 삭제되는 행 페이지 수.
  await beginWrite(ctx, 1 + (await databaseRowPages(ctx, input.databaseId, workspaceId)).length);
  await permanentlyDeleteDatabase({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, id: input.databaseId, workspaceId });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, workspaceId);
  return { deleted: input.databaseId, permanent: true };
}

/** emptyTrash 와 같은 조건(deletedAt 속성 존재)으로 휴지통 페이지 수를 센다. */
async function countTrashedPages(ctx: McpContext, workspaceId: string): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": workspaceId },
        FilterExpression: "attribute_exists(deletedAt)",
        ProjectionExpression: "id, deletedAt",
        ExclusiveStartKey: startKey,
      }),
    );
    count += ((r.Items ?? []) as Item[]).filter((it) => it.deletedAt !== undefined).length;
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return count;
}

export const emptyTrashInputShape = {
  workspaceId: idInput.describe("Workspace whose trashed pages are all permanently deleted (trashed databases are not touched)"),
  confirm: confirmInput,
};
const emptyTrashInput = z.object(emptyTrashInputShape);

export async function emptyTrashTool(ctx: McpContext, raw: z.input<typeof emptyTrashInput>) {
  const input = emptyTrashInput.parse(raw);
  requireConfirm(input.confirm);
  await requireWorkspaceFor(ctx, input.workspaceId, "write");
  // 상한 없는 일괄 삭제라 먼저 세고 그만큼 소비한다(남은 한도를 넘으면 아무것도 지우지 않고 거부).
  const trashed = await countTrashedPages(ctx, input.workspaceId);
  if (trashed === 0) return { workspaceId: input.workspaceId, deletedPages: 0, permanent: true };
  await beginWrite(ctx, trashed);
  const count = await emptyTrash({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, workspaceId: input.workspaceId });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, input.workspaceId);
  return { workspaceId: input.workspaceId, deletedPages: count, permanent: true };
}
