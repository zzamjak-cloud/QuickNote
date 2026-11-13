// 페이지 버전 히스토리 — 목록·수동 저장·복원.
// 복원은 v5 restorePageVersion 으로 Pages 를 되돌린 뒤, 협업 룸(본문 권위)에도 같은 본문을 replace 로 써 넣는다
// (update_page replace 와 같은 collabWriter 경로). 룸을 안 바꾸면 열린 클라의 8초 materialize 가 옛 본문으로 되돌린다.
// DB 행은 셀 권위인 DB 룸에도 그 시점 셀을 정확히 복원한다(클라 restoreRowCellsToCollabDoc 과 같은 결과).
import { z } from "zod";
import { normalizeLegacyJsonNode, type DocJson } from "../../../_shared/collabContent";
import { hasMeaningfulPageDocContent } from "../../../v5-resolvers/handlers/pageDatabase";
import { listPageHistory, restorePageVersion, savePageVersion } from "../../../v5-resolvers/handlers/pageDatabase/history";
import { NOT_ACCESSIBLE } from "../../access";
import { loadBodyBase, writePageBody } from "../../collabWriter";
import { ToolError, type McpContext } from "../../context";
import { restoreDbRow } from "../../dbCollabWriter";
import { getItem } from "../../ddb";
import { requireCollabEpoch } from "../../epochGuard";
import { invalidateWorkspaceMetas } from "../../pageScan";
import { recordBodyCheckpoint } from "../../pageWrite";
import { parseCells } from "../../properties";
import { publishPage } from "../../publish";
import { parseDocJson } from "../../text";
import { loadWritablePage, requireWritableWorkspace, requireWriteScope } from "../../writeAccess";
import { historySnapshot, idInput, isTrashed, loadPageAnyState, summarizeHistoryEntry } from "./shared";

type Item = Record<string, unknown>;

export const VERSION_NOT_FOUND = "Version not found for this page (versions older than 180 days expire)";

const limitInput = z.number().int().min(1).max(100).optional().describe("Max versions, newest first (default 30)");

export const listPageHistoryInputShape = { pageId: idInput.describe("Page (or database row) id; trashed pages allowed"), limit: limitInput };
const listPageHistoryInput = z.object(listPageHistoryInputShape);

export async function listPageHistoryTool(ctx: McpContext, raw: z.input<typeof listPageHistoryInput>) {
  const input = listPageHistoryInput.parse(raw);
  const page = await loadPageAnyState(ctx, input.pageId, "read");
  const entries = await listPageHistory({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    pageId: input.pageId, workspaceId: String(page.workspaceId), limit: input.limit ?? 30,
  });
  return {
    pageId: input.pageId,
    title: page.title ?? "",
    inTrash: isTrashed(page),
    versions: entries.map((e) => summarizeHistoryEntry(e)),
    note: "Restore with restore_page_version {pageId, historyId}.",
  };
}

export const savePageVersionInputShape = { pageId: idInput.describe("Page to checkpoint") };
const savePageVersionInput = z.object(savePageVersionInputShape);

async function latestHistoryId(ctx: McpContext, page: Item): Promise<string | null> {
  const [latest] = await listPageHistory({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, pageId: String(page.id), workspaceId: String(page.workspaceId), limit: 1,
  });
  return latest ? String(latest.historyId) : null;
}

/**
 * 수동 "현재 버전 저장"(page.checkpoint). 본문은 Pages.doc(8초 지연 스냅샷)이 아니라 협업 룸 본문을 기록한다
 * (update_page 의 교체 전 체크포인트와 같은 recordBodyCheckpoint). 풀페이지 DB 홈은 본문이 없어 resolver 그대로.
 */
export async function savePageVersionTool(ctx: McpContext, raw: z.input<typeof savePageVersionInput>) {
  const input = savePageVersionInput.parse(raw);
  const page = await loadWritablePage(ctx, input.pageId);
  if (page.fullPageDatabaseId) {
    await savePageVersion({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, input: { pageId: input.pageId, workspaceId: String(page.workspaceId) } });
  } else {
    await requireCollabEpoch(ctx);
    const base = await loadBodyBase(ctx, page);
    await recordBodyCheckpoint(ctx, page, base.doc);
  }
  return { pageId: input.pageId, saved: true, historyId: await latestHistoryId(ctx, page) };
}

export const restorePageVersionInputShape = {
  pageId: idInput.describe("Page (or database row) id"),
  historyId: z.string().trim().min(1).max(256).describe("historyId from list_page_history / list_database_row_history"),
};
const restorePageVersionInput = z.object(restorePageVersionInputShape);

/** 대상 워크스페이스·히스토리 엔트리 인가. 페이지가 영구삭제(TTL)됐어도 엔트리의 워크스페이스로 인가해 되살릴 수 있다. */
async function authorizeRestore(ctx: McpContext, pageId: string, historyId: string): Promise<{ page: Item | null; entry: Item; workspaceId: string }> {
  requireWriteScope(ctx);
  const [page, entry] = await Promise.all([
    getItem(ctx.doc, ctx.tables.Pages, { id: pageId }),
    getItem(ctx.doc, ctx.tables.PageHistory, { pageId, historyId }),
  ]);
  const workspaceId = String(page?.workspaceId ?? entry?.workspaceId ?? "");
  if (!workspaceId) throw new ToolError(NOT_ACCESSIBLE);
  await requireWritableWorkspace(ctx, workspaceId);
  if (!entry || entry.workspaceId !== workspaceId) throw new ToolError(VERSION_NOT_FOUND);
  return { page, entry, workspaceId };
}

/** 복원본 본문을 룸에 replace 로 반영(+ Pages materialize·발행). 빈 본문 버전은 룸을 비우지 않는다(writePageBody 가드). */
async function syncRestoredBody(ctx: McpContext, restored: Item) {
  const doc = parseDocJson(restored.doc);
  if (!doc || !hasMeaningfulPageDocContent(doc)) return { liveBody: "skipped" as const };
  const base = await loadBodyBase(ctx, restored);
  const result = await writePageBody(ctx, restored, base, { kind: "replace", doc: normalizeLegacyJsonNode(doc as unknown as DocJson) });
  return {
    liveBody: result.changed ? ("updated" as const) : ("unchanged" as const),
    ...(result.broadcast ? { liveClients: result.broadcast.delivered } : {}),
  };
}

export async function restorePageVersionTool(ctx: McpContext, raw: z.input<typeof restorePageVersionInput>) {
  const input = restorePageVersionInput.parse(raw);
  const { page, entry, workspaceId } = await authorizeRestore(ctx, input.pageId, input.historyId);
  const isHome = Boolean(page?.fullPageDatabaseId);
  await requireCollabEpoch(ctx);
  const base = page && !isHome ? await loadBodyBase(ctx, page) : null;
  const currentMeaningful = Boolean(base && hasMeaningfulPageDocContent(base.doc));
  const target = historySnapshot(entry);
  if (target && currentMeaningful && !hasMeaningfulPageDocContent(parseDocJson(target.doc))) {
    throw new ToolError("That version has an empty body; restoring it would clear the page. Pick another version.");
  }
  // 복원 직전 현재 협업 본문을 체크포인트로 남겨 복원 자체를 되돌릴 수 있게 한다(Pages.doc 은 최대 8초 늦다).
  if (page && base && currentMeaningful) await recordBodyCheckpoint(ctx, page, base.doc);

  const restored = await restorePageVersion({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    input: { pageId: input.pageId, workspaceId, historyId: input.historyId },
  });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, workspaceId);
  await publishPage(restored);
  const body = isHome ? { liveBody: "skipped" as const } : await syncRestoredBody(ctx, restored);
  const databaseId = typeof restored.databaseId === "string" && restored.databaseId ? restored.databaseId : null;
  const cellsWrittenTo = databaseId
    ? await restoreDbRow(ctx, databaseId, input.pageId, parseCells(restored.dbCells), { exact: true })
    : undefined;
  return {
    pageId: input.pageId,
    restoredFrom: input.historyId,
    wasInTrash: Boolean(page && isTrashed(page)),
    wasMissing: !page,
    checkpointBeforeRestore: Boolean(page && currentMeaningful),
    ...body,
    ...(cellsWrittenTo ? { cellsWrittenTo } : {}),
  };
}
