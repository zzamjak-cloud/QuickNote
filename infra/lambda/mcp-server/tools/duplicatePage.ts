// duplicate_page — 앱 duplicatePage 와 같은 의미: 선택한 페이지 자신만 복제(자식 제외), 제목 "{title} (Copy)",
// 원본 바로 다음 순서. 본문은 현재 협업 본문을 기준으로 하고 블록 id 는 새로 만든다.
// database 블록은 앱처럼 같은 DB 를 가리키는 참조로 복제된다(DB 자체는 복제하지 않음).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadBodyBase } from "../collabWriter";
import { ToolError, type McpContext } from "../context";
import { requireCollabEpoch } from "../epochGuard";
import { prepareNewDoc, workspaceMetas } from "../pageHelpers";
import { nowIso, saveNewPage } from "../pageWrite";
import { loadWritablePage } from "../writeAccess";

export const duplicatePageInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page to duplicate"),
  includeChildren: z.literal(false).optional().describe("Child pages are never duplicated (same as the app)"),
};
const duplicatePageInput = z.object(duplicatePageInputShape);
export type DuplicatePageInput = z.input<typeof duplicatePageInput>;

type Item = Record<string, unknown>;
const COPIED_META = ["icon", "coverImage", "titleColor"] as const;

/** 원본과 다음 형제 사이(없으면 +1). 숫자 문자열 order 라 형제 재번호 없이 끼워 넣는다. */
function orderAfter(source: Item, siblingOrders: number[]): string {
  const current = Number(source.order) || 0;
  const next = siblingOrders.filter((o) => o > current).sort((a, b) => a - b)[0];
  return String(next === undefined ? current + 1 : (current + next) / 2);
}

export async function duplicatePageTool(ctx: McpContext, raw: DuplicatePageInput) {
  const input = duplicatePageInput.parse(raw);
  const source = await loadWritablePage(ctx, input.pageId);
  if (source.databaseId) throw new ToolError("Database rows cannot be duplicated via MCP; use create_pages with the database as parent");
  if (source.fullPageDatabaseId) throw new ToolError("Full-page database homes cannot be duplicated via MCP");

  // 원본 본문은 협업 룸에서 읽는다 — epoch 이 어긋나면 낡은 본문을 복제하게 된다.
  await requireCollabEpoch(ctx);
  const base = await loadBodyBase(ctx, source);
  const doc = prepareNewDoc((base.doc.content ?? []).length > 0 ? base.doc : null, { freshIds: true });
  const metas = await workspaceMetas(ctx, String(source.workspaceId));
  const parentId = typeof source.parentId === "string" && source.parentId ? source.parentId : null;
  const siblings = metas.filter((m) => !m.databaseId && m.parentId === parentId && m.id !== source.id);
  const now = nowIso();
  const id = randomUUID();
  const title = `${String(source.title ?? "")} (Copy)`;
  const { page } = await saveNewPage(ctx, {
    id,
    workspaceId: source.workspaceId,
    createdByMemberId: ctx.caller.memberId,
    title,
    ...Object.fromEntries(COPIED_META.filter((k) => source[k] != null).map((k) => [k, source[k]])),
    parentId,
    order: orderAfter(source, siblings.map((s) => s.order)),
    doc: JSON.stringify(doc),
    createdAt: now,
    updatedAt: now,
  });
  return { id, title, updatedAt: String(page.updatedAt ?? now), sourceId: String(source.id) };
}
