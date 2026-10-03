// duplicate_page — 앱 duplicatePage 와 같은 의미: 선택한 페이지 자신만 복제(자식 제외), 제목 "{title} (Copy)",
// 원본 바로 다음 순서. 본문은 현재 협업 본문을 기준으로 하고 블록 id 는 새로 만든다. DB 행은 셀까지 복제하고
// 협업 DB 룸의 rows·rowMembers·rowPageOrder 에도 넣는다.
// database 블록은 앱처럼 같은 DB 를 가리키는 참조로 복제된다(DB 자체는 복제하지 않음).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadBodyBase } from "../collabWriter";
import { ToolError, type McpContext } from "../context";
import { readDbRoomRoot, writeDbRowCells } from "../dbCollabWriter";
import { requireCollabEpoch } from "../epochGuard";
import { parseCells } from "../properties";
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

/** 행 복제 셀 — 룸이 시드돼 있으면 룸(권위)의 셀, 아니면 Pages.dbCells. 템플릿 마커는 복사하지 않는다. */
async function sourceCells(ctx: McpContext, source: Item): Promise<Record<string, unknown>> {
  const root = await readDbRoomRoot(ctx, String(source.databaseId));
  const rows = root?.rows as Record<string, Record<string, unknown>> | undefined;
  const { _qn_isTemplate: _marker, ...cells } = rows?.[String(source.id)] ?? parseCells(source.dbCells);
  return cells;
}

export async function duplicatePageTool(ctx: McpContext, raw: DuplicatePageInput) {
  const input = duplicatePageInput.parse(raw);
  const source = await loadWritablePage(ctx, input.pageId);
  if (source.fullPageDatabaseId) throw new ToolError("Full-page database homes cannot be duplicated via MCP");
  const databaseId = typeof source.databaseId === "string" && source.databaseId ? source.databaseId : null;
  if (databaseId && parseCells(source.dbCells)._qn_isTemplate === "1") throw new ToolError("Database templates cannot be duplicated via MCP");

  // 원본 본문·셀은 협업 룸에서 읽는다 — epoch 이 어긋나면 낡은 본문을 복제하게 된다.
  await requireCollabEpoch(ctx);
  const base = await loadBodyBase(ctx, source);
  const doc = prepareNewDoc((base.doc.content ?? []).length > 0 ? base.doc : null, { freshIds: true });
  const cells = databaseId ? await sourceCells(ctx, source) : null;
  const metas = await workspaceMetas(ctx, String(source.workspaceId));
  const parentId = typeof source.parentId === "string" && source.parentId ? source.parentId : null;
  // 앱과 같은 순서 스코프: 일반 페이지는 같은 부모, DB 행은 같은 DB.
  const siblings = metas.filter((m) => m.id !== source.id && (databaseId ? m.databaseId === databaseId : !m.databaseId && m.parentId === parentId));
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
    databaseId,
    dbCells: cells ? JSON.stringify(cells) : null,
    doc: JSON.stringify(doc),
    createdAt: now,
    updatedAt: now,
  });
  // DB 행: 룸이 시드돼 있으면 셀·멤버십을 원본 바로 뒤에 넣는다(앱 duplicatePage 는 원본 다음 순서).
  const cellsWrittenTo = databaseId && cells ? await writeDbRowCells(ctx, databaseId, id, cells, { newRow: true, after: String(source.id) }) : undefined;
  return { id, title, updatedAt: String(page.updatedAt ?? now), sourceId: String(source.id), ...(cellsWrittenTo ? { cellsWrittenTo } : {}) };
}
