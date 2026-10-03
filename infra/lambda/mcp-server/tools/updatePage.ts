// update_page — 제목·아이콘·DB 행 속성·본문(5개 모드 중 replace/append/insert_after/replace_range)을 한 번에 갱신.
// 본문은 collabWriter(Yjs 룸) 경로, 셀은 DB 룸 + Pages.dbCells 양쪽, 메타는 같은 upsert 에 싣는다.
import { z } from "zod";
import type { DocNode } from "../../../../src/lib/docModel/types";
import { convertProperties, mergeCells } from "../cellInput";
import { pageIconInput } from "../iconInput";
import { loadBodyBase, writePageBody } from "../collabWriter";
import { contentInput, databaseIdsOf, planContentEdit } from "../contentEdit";
import { ToolError, type McpContext } from "../context";
import { writeDbRowCells } from "../dbCollabWriter";
import { requireCollabEpoch } from "../epochGuard";
import { assertDatabasesUsable, normalizeTitle, workspaceMetas } from "../pageHelpers";
import { patchPage, type PagePatch } from "../pageWrite";
import { parseCells } from "../properties";
import { loadWritableDatabase, loadWritablePage } from "../writeAccess";
import { saveDatabase } from "../dbStructureWriter";
import { renameDatabase } from "./updateDatabase";

export const updatePageInputShape = {
  pageId: z.string().trim().min(1).max(256).describe("Page id to update"),
  title: z.string().max(500).optional().describe("New title"),
  icon: pageIconInput.nullable().optional()
    .describe('New icon: emoji, "quicknote-lucide:<Name>:<hex>" or "quicknote-image://<imageId>"; null removes it'),
  properties: z.record(z.string(), z.unknown()).optional()
    .describe("Database rows only: {columnNameOrId: value}; null clears a cell. Same value rules as create_pages"),
  content: contentInput.optional().describe("Body edit. replace/replace_range save a version-history checkpoint first"),
};
const updatePageInput = z.object(updatePageInputShape);
export type UpdatePageInput = z.input<typeof updatePageInput>;

type Item = Record<string, unknown>;
type MetaPatch = { patch: PagePatch; cells: Record<string, unknown> | null };

async function assertTitleAvailable(ctx: McpContext, page: Item, title: string): Promise<void> {
  if (page.databaseId) return; // DB 행은 클라도 제목 중복을 막지 않는다
  const wanted = normalizeTitle(title);
  const metas = await workspaceMetas(ctx, String(page.workspaceId));
  if (metas.some((m) => m.id !== page.id && normalizeTitle(m.title) === wanted)) {
    throw new ToolError(`A page titled "${wanted}" already exists in this workspace`);
  }
}

async function buildMetaPatch(ctx: McpContext, page: Item, input: z.infer<typeof updatePageInput>): Promise<MetaPatch> {
  const fields: Item = {};
  let cells: Record<string, unknown> | null = null;
  let title = input.title;
  if (input.properties) {
    if (!page.databaseId) throw new ToolError("properties can only be set on database rows");
    const db = await loadWritableDatabase(ctx, String(page.databaseId));
    const converted = await convertProperties(ctx, db, input.properties);
    if (title !== undefined && converted.title !== undefined && title !== converted.title) {
      throw new ToolError("Give the row title either as title or as the title column, not both");
    }
    title ??= converted.title;
    cells = converted.cells;
  }
  if (title !== undefined) {
    await assertTitleAvailable(ctx, page, title);
    fields.title = page.databaseId ? title.trim() : normalizeTitle(title);
  }
  if (input.icon !== undefined) fields.icon = input.icon;
  if (!cells) return { patch: fields, cells };
  const changedCells = cells;
  // 셀은 저장 직전 최신 dbCells 에 병합한다(그 사이 다른 셀 편집 보존).
  return {
    patch: (latest) => ({ ...fields, dbCells: JSON.stringify(mergeCells(parseCells(latest.dbCells), changedCells)) }),
    cells,
  };
}

async function renameFullPageDatabase(ctx: McpContext, page: Item, input: z.infer<typeof updatePageInput>) {
  if (input.properties) throw new ToolError("properties can only be set on database rows");
  const db = await loadWritableDatabase(ctx, String(page.fullPageDatabaseId));
  const title = input.title as string;
  await renameDatabase(ctx, db, title);
  await saveDatabase(ctx, db, { title: normalizeTitle(title) });
  const saved = input.icon !== undefined ? (await patchPage(ctx, String(page.id), { icon: input.icon })).page : page;
  return { id: String(page.id), databaseId: String(db.id), updatedAt: String(saved.updatedAt ?? ""), contentChanged: false, renamedDatabase: true };
}

export async function updatePageTool(ctx: McpContext, raw: UpdatePageInput) {
  const input = updatePageInput.parse(raw);
  if (input.title === undefined && input.icon === undefined && !input.properties && !input.content) {
    throw new ToolError("Nothing to update: pass title, icon, properties or content");
  }
  const page = await loadWritablePage(ctx, input.pageId);
  if (page.fullPageDatabaseId) {
    if (input.content) throw new ToolError("This page is a full-page database home; its body is the database view (edit rows or columns instead)");
    // 앱 규약: 홈 제목 = DB 제목(setDatabaseTitle 이 홈을 함께 바꾼다) → 제목 변경은 DB 이름 변경으로 처리.
    if (input.title !== undefined) return renameFullPageDatabase(ctx, page, input);
  }
  // 본문·셀은 협업 룸이 권위 — epoch 이 어긋나면 쓰기가 조용히 덮어써지므로 먼저 막는다(메타 전용은 무관).
  if (input.content || input.properties) await requireCollabEpoch(ctx);
  const { patch, cells } = await buildMetaPatch(ctx, page, input);
  // 셀 권위(DB 룸)를 먼저 갱신해야 열린 DB 뷰의 materialize 가 옛 셀로 Pages.dbCells 를 되돌리지 않는다.
  const cellsWrittenTo = cells ? await writeDbRowCells(ctx, String(page.databaseId), String(page.id), cells) : undefined;

  if (!input.content) {
    const { page: saved } = await patchPage(ctx, String(page.id), patch);
    return { id: String(page.id), updatedAt: String(saved.updatedAt), contentChanged: false, ...(cellsWrittenTo ? { cellsWrittenTo } : {}) };
  }
  const base = await loadBodyBase(ctx, page);
  const plan = planContentEdit(base.doc, input.content);
  const existing = new Set(databaseIdsOf(base.doc as DocNode));
  await assertDatabasesUsable(ctx, plan.databaseIds.filter((id) => !existing.has(id)), String(page.workspaceId));
  const result = await writePageBody(ctx, page, base, plan.edit, { checkpoint: plan.checkpoint, patch });
  return {
    id: String(page.id),
    updatedAt: String(result.saved?.page.updatedAt ?? page.updatedAt ?? ""),
    contentChanged: result.changed,
    bodySource: base.source,
    historyCheckpoint: result.checkpointed,
    ...(result.broadcast ? { liveClients: result.broadcast.delivered } : {}),
    // 본문은 룸에 반영됐으나 Pages 스냅샷 저장이 밀린 경우 — 본문 재전송 금지(중복). 제목·아이콘·속성은 멱등이라 재시도 가능.
    ...(result.changed && !result.materialized
      ? { materialized: false, note: "Body was applied live; the stored snapshot will catch up. Do not resend the content. Re-send only title/icon/properties if they were included." }
      : {}),
    ...(cellsWrittenTo ? { cellsWrittenTo } : {}),
  };
}
