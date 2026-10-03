// move_pages — 같은 워크스페이스 안에서 부모 변경. 새 부모 형제의 끝에 순서대로 붙인다.
// DB 행은 DB 소속이 정체성이라 이동 대상이 아니다. 자기 자신·자손 아래로의 이동(순환)은 거부한다.
import { z } from "zod";
import { ToolError, type McpContext } from "../context";
import { isSelfOrDescendant, nextSiblingOrder, workspaceMetas } from "../pageHelpers";
import { patchPage } from "../pageWrite";
import { loadWritablePage, requireWritableWorkspace } from "../writeAccess";

const idString = z.string().trim().min(1).max(256);

export const movePagesInputShape = {
  pageIds: z.array(idString).min(1).max(20).describe("Pages to move (1-20), kept in this order"),
  newParent: z
    .union([z.object({ pageId: idString }).strict(), z.object({ workspaceId: idString }).strict()])
    .describe("{pageId} to nest under a page, or {workspaceId} to move to the workspace top level (same workspace only)"),
};
const movePagesInput = z.object(movePagesInputShape);
export type MovePagesInput = z.input<typeof movePagesInput>;

type Item = Record<string, unknown>;

async function loadMovedPages(ctx: McpContext, ids: string[]): Promise<Item[]> {
  const pages: Item[] = [];
  for (const id of ids) {
    const page = await loadWritablePage(ctx, id);
    if (page.databaseId) throw new ToolError(`Page ${id} is a database row and cannot be moved`);
    pages.push(page);
  }
  const workspaces = new Set(pages.map((p) => String(p.workspaceId)));
  if (workspaces.size > 1) throw new ToolError("All pages must be in the same workspace");
  return pages;
}

async function resolveParentId(ctx: McpContext, parent: MovePagesInput["newParent"], workspaceId: string): Promise<string | null> {
  if ("workspaceId" in parent) {
    if (parent.workspaceId !== workspaceId) throw new ToolError("Moving pages to another workspace is not supported");
    await requireWritableWorkspace(ctx, workspaceId);
    return null;
  }
  const target = await loadWritablePage(ctx, parent.pageId);
  if (String(target.workspaceId) !== workspaceId) throw new ToolError("Moving pages to another workspace is not supported");
  return String(target.id);
}

export async function movePagesTool(ctx: McpContext, raw: MovePagesInput) {
  const input = movePagesInput.parse(raw);
  const ids = Array.from(new Set(input.pageIds));
  const pages = await loadMovedPages(ctx, ids);
  const workspaceId = String(pages[0].workspaceId);
  const parentId = await resolveParentId(ctx, input.newParent, workspaceId);
  const metas = await workspaceMetas(ctx, workspaceId);
  const byId = new Map(metas.map((m) => [m.id, m]));
  if (parentId) {
    const cyclic = ids.find((id) => isSelfOrDescendant(byId, parentId, id));
    if (cyclic) throw new ToolError(`Cannot move page ${cyclic} under itself or one of its descendants`);
  }
  const moving = new Set(ids);
  const firstOrder = nextSiblingOrder(metas.filter((m) => !moving.has(m.id)), { parentId, databaseId: null });
  const moved: { id: string; parentId: string | null; updatedAt: string }[] = [];
  for (const [i, page] of pages.entries()) {
    const { page: saved } = await patchPage(ctx, String(page.id), { parentId, order: String(firstOrder + i) });
    moved.push({ id: String(page.id), parentId, updatedAt: String(saved.updatedAt) });
  }
  return { moved };
}
