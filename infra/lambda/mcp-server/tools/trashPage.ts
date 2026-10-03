// trash_page — 휴지통 이동(soft delete)만 한다. 영구삭제는 제공하지 않는다(30일 보관 후 TTL 정리, 앱에서 복원 가능).
// 자손 페이지도 함께 이동한다(앱 deletePage 와 같은 parentId 범위).
// PageInput 에 deletedAt 이 없어 publishPageChanged 로는 삭제를 전파할 수 없다 — 열린 클라는 다음 동기화(델타 fetch)에서 반영한다.
import { z } from "zod";
import { softDeletePage } from "../../v5-resolvers/handlers/pageDatabase";
import { ToolError, type McpContext } from "../context";
import { descendantIds, workspaceMetas } from "../pageHelpers";
import { nowIso } from "../pageWrite";
import { loadWritablePage } from "../writeAccess";

export const trashPageInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page to move to the trash (child pages follow)"),
};
const trashPageInput = z.object(trashPageInputShape);
export type TrashPageInput = z.input<typeof trashPageInput>;

export async function trashPageTool(ctx: McpContext, raw: TrashPageInput) {
  const input = trashPageInput.parse(raw);
  const page = await loadWritablePage(ctx, input.pageId);
  // DB 행 삭제는 DB 룸 멤버십(rowMembers)·행 순서까지 맞춰야 해서 DB 쓰기 단계(P3)로 미룬다.
  if (page.databaseId) throw new ToolError("Database rows cannot be trashed via MCP yet; delete the row in QuickNote");
  if (page.fullPageDatabaseId) throw new ToolError("Full-page database homes cannot be trashed via MCP; delete the database in QuickNote");

  const workspaceId = String(page.workspaceId);
  const metas = await workspaceMetas(ctx, workspaceId);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const ids = [String(page.id), ...descendantIds(metas, String(page.id))];
  const updatedAt = nowIso();
  for (const id of ids) {
    const meta = byId.get(id);
    await softDeletePage({
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
  }
  return { trashed: ids, restorable: true, note: "Moved to trash; restore from QuickNote trash within 30 days" };
}
