// trash_page — 휴지통 이동(soft delete)만 한다. 영구삭제는 제공하지 않는다(30일 보관 후 TTL 정리, 앱에서 복원 가능).
// 자손 페이지도 함께 이동한다(앱 deletePage 와 같은 parentId 범위). DB 행은 협업 DB 룸의 행 목록에서도 뺀다.
// 삭제는 publishPageChanged(deletedAt) 로 전파한다 — 구독 클라는 tombstone 으로 받아 목록에서 즉시 제거한다.
import { z } from "zod";
import { softDeletePage } from "../../v5-resolvers/handlers/pageDatabase";
import { ToolError, type McpContext } from "../context";
import { descendantIds, workspaceMetas } from "../pageHelpers";
import { nowIso } from "../pageWrite";
import { publishPage } from "../publish";
import { removeDbRow } from "../dbCollabWriter";
import { requireCollabEpoch } from "../epochGuard";
import { loadWritablePage } from "../writeAccess";

export const trashPageInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page to move to the trash (child pages follow)"),
};
const trashPageInput = z.object(trashPageInputShape);
export type TrashPageInput = z.input<typeof trashPageInput>;

export async function trashPageTool(ctx: McpContext, raw: TrashPageInput) {
  const input = trashPageInput.parse(raw);
  const page = await loadWritablePage(ctx, input.pageId);
  if (page.fullPageDatabaseId) throw new ToolError("Full-page database homes cannot be trashed via MCP; delete the database in QuickNote");

  const workspaceId = String(page.workspaceId);
  const metas = await workspaceMetas(ctx, workspaceId);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const ids = [String(page.id), ...descendantIds(metas, String(page.id))];
  const rowDatabaseId = typeof page.databaseId === "string" && page.databaseId ? page.databaseId : null;
  // DB 행은 협업 DB 룸(rows·rowMembers·rowPageOrder)에서도 빼야 열린 뷰의 materialize 가 유령 행을 되살리지 않는다.
  if (rowDatabaseId) await requireCollabEpoch(ctx);
  const updatedAt = nowIso();
  for (const id of ids) {
    const meta = byId.get(id);
    const deleted = await softDeletePage({
      doc: ctx.doc,
      tables: ctx.tables,
      caller: ctx.caller,
      id,
      workspaceId,
      updatedAt,
      title: id === page.id ? String(page.title ?? "") : meta?.title ?? null,
      ...(id === page.id ? { icon: (page.icon as string | null | undefined) ?? null } : {}),
      databaseId: meta?.databaseId ?? null,
    });
    await publishPage(deleted, { deletedAt: String(deleted.deletedAt ?? updatedAt) });
  }
  // 앱 deleteRow 순서와 같이 행 페이지 삭제 후 DB 행 목록에서 뺀다.
  const rowRemovedFrom = rowDatabaseId ? await removeDbRow(ctx, rowDatabaseId, String(page.id)) : undefined;
  return {
    trashed: ids,
    restorable: true,
    ...(rowRemovedFrom ? { rowRemovedFrom } : {}),
    note: "Moved to trash; restore from QuickNote trash within 30 days",
  };
}
