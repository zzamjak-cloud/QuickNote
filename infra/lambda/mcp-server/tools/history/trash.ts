// 휴지통 — 목록·페이지/DB 복원·DB 휴지통 이동.
// 복원·이동은 v5 resolver(restorePage·restoreDatabase·softDeletePage·softDeleteDatabase)를 그대로 쓰고
// publishPageChanged/publishDatabaseChanged(deletedAt 이면 tombstone)로 열린 클라에 전파한다.
// DB 행 복원은 DB 룸(rows·rowMembers·rowPageOrder)에도 행을 되살린다 — trash_page 가 룸에서 뺀 행이 materialize 로
// 다시 사라지지 않게(클라 applyRemotePageToStore 의 rowPageOrder 재연결과 같은 결과).
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { restorePage, softDeletePage } from "../../../v5-resolvers/handlers/pageDatabase";
import { softDeleteDatabase } from "../../../v5-resolvers/handlers/pageDatabase/database";
import {
  TRASH_RETENTION_MS,
  listTrashedDatabases,
  listTrashedPages,
  restoreDatabase,
} from "../../../v5-resolvers/handlers/pageDatabase/trash";
import { ToolError, type McpContext } from "../../context";
import { restoreDbRow } from "../../dbCollabWriter";
import { findDatabaseHomeId } from "../../dbPath";
import { requireCollabEpoch } from "../../epochGuard";
import { descendantIds } from "../../pageHelpers";
import { MAX_SCANNED_METAS, invalidateWorkspaceMetas, scanWorkspaceMetas, type PageMeta } from "../../pageScan";
import { nowIso } from "../../pageWrite";
import { parseCells } from "../../properties";
import { publishDatabase, publishPage } from "../../publish";
import { beginWrite } from "../../writeAccess";
import { idInput, isTrashed, loadDatabaseAnyState, loadPageAnyState, pagesTrashedTogether, requireWorkspaceFor } from "./shared";

type Item = Record<string, unknown>;

/** trash_database 가 한 호출에서 함께 휴지통에 넣는 행 상한(Lambda 시간 한도). */
export const MAX_TRASH_DATABASE_ROWS = 500;

function daysLeft(deletedAt: unknown): number | null {
  const at = typeof deletedAt === "string" ? Date.parse(deletedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at + TRASH_RETENTION_MS - Date.now()) / 86_400_000));
}

function trashedPageView(p: Item): Item {
  return {
    id: p.id,
    title: p.title ?? "",
    type: p.fullPageDatabaseId ? "databaseHome" : p.databaseId ? "databaseRow" : "page",
    ...(p.databaseId ? { databaseId: p.databaseId } : {}),
    ...(p.parentId ? { parentId: p.parentId } : {}),
    deletedAt: p.deletedAt,
    daysUntilPurge: daysLeft(p.deletedAt),
  };
}

export const listTrashInputShape = {
  workspaceId: idInput.describe("Workspace id (see list_workspaces)"),
  kind: z.enum(["all", "pages", "databases"]).optional().describe("Default all"),
  limit: z.number().int().min(1).max(50).optional().describe("Max items per kind (default 30)"),
  pagesCursor: z.string().max(4096).optional().describe("pagesCursor from a previous call"),
  databasesCursor: z.string().max(4096).optional().describe("databasesCursor from a previous call"),
};
const listTrashInput = z.object(listTrashInputShape);

export async function listTrashTool(ctx: McpContext, raw: z.input<typeof listTrashInput>) {
  const input = listTrashInput.parse(raw);
  await requireWorkspaceFor(ctx, input.workspaceId, "read");
  const kind = input.kind ?? "all";
  const base = { doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, workspaceId: input.workspaceId, limit: input.limit ?? 30 };
  const out: Item = { workspaceId: input.workspaceId, retentionDays: TRASH_RETENTION_MS / 86_400_000 };
  if (kind !== "databases") {
    const pages = await listTrashedPages({ ...base, nextToken: input.pagesCursor ?? null });
    out.pages = pages.items.map(trashedPageView);
    out.pagesCursor = pages.nextToken ?? null;
  }
  if (kind !== "pages") {
    const dbs = await listTrashedDatabases({ ...base, nextToken: input.databasesCursor ?? null });
    out.databases = dbs.items.map((d) => ({ id: d.id, title: d.title ?? "", deletedAt: d.deletedAt, daysUntilPurge: daysLeft(d.deletedAt) }));
    out.databasesCursor = dbs.nextToken ?? null;
  }
  return out;
}

/** 휴지통 페이지 1건 복원 + 발행 + (DB 행이면) DB 룸 행 복귀. */
async function restoreOnePage(ctx: McpContext, id: string, workspaceId: string): Promise<{ id: string; rowRestoredTo?: string }> {
  const restored = await restorePage({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, id, workspaceId });
  await publishPage(restored);
  const databaseId = typeof restored.databaseId === "string" && restored.databaseId ? restored.databaseId : null;
  if (!databaseId) return { id };
  const rowRestoredTo = await restoreDbRow(ctx, databaseId, id, parseCells(restored.dbCells), { exact: false });
  return { id, rowRestoredTo };
}

async function restorePages(ctx: McpContext, targets: Item[], workspaceId: string) {
  if (targets.some((p) => typeof p.databaseId === "string" && p.databaseId)) await requireCollabEpoch(ctx);
  const restored = [];
  for (const p of targets) restored.push(await restoreOnePage(ctx, String(p.id), workspaceId));
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, workspaceId);
  return restored;
}

async function allMetas(ctx: McpContext, workspaceId: string): Promise<PageMeta[]> {
  return (await scanWorkspaceMetas({ doc: ctx.doc, pagesTable: ctx.tables.Pages, workspaceId, budget: MAX_SCANNED_METAS, fresh: true })).metas;
}

export const restorePageInputShape = {
  pageId: idInput.describe("Trashed page id (see list_trash)"),
  includeChildren: z.boolean().optional().describe("Also restore child pages trashed together with it (default true)"),
};
const restorePageInput = z.object(restorePageInputShape);

export async function restorePageTool(ctx: McpContext, raw: z.input<typeof restorePageInput>) {
  const input = restorePageInput.parse(raw);
  const page = await loadPageAnyState(ctx, input.pageId, "write");
  if (!isTrashed(page)) throw new ToolError("This page is not in the trash");
  const workspaceId = String(page.workspaceId);
  const metas = await allMetas(ctx, workspaceId);
  const childIds = input.includeChildren === false ? [] : descendantIds(metas, input.pageId);
  const children = await pagesTrashedTogether(ctx, childIds, String(page.deletedAt));
  // 인가·대상 확정 후 실제로 되살리는 페이지 수만큼 일일 쓰기 상한을 소비한다.
  await beginWrite(ctx, 1 + children.length);
  const restored = await restorePages(ctx, [page, ...children], workspaceId);
  const parent = page.parentId ? metas.find((m) => m.id === page.parentId) : undefined;
  return {
    restored: restored.map((r) => r.id),
    ...(restored.some((r) => r.rowRestoredTo) ? { rowRestoredTo: restored.find((r) => r.rowRestoredTo)?.rowRestoredTo } : {}),
    ...(parent?.deleted ? { note: "Its parent page is still in the trash; restore the parent too or move this page with move_pages." } : {}),
  };
}

/** DB 와 함께 휴지통에 들어간 행·풀페이지 홈(앱 deleteDatabase 는 행·홈을 먼저 지운다). */
async function pagesTrashedWithDatabase(ctx: McpContext, db: Item): Promise<Item[]> {
  const metas = await allMetas(ctx, String(db.workspaceId));
  const candidates = metas.filter((m) => m.deleted && (m.databaseId === db.id || (!m.databaseId && m.title === db.title)));
  const together = await pagesTrashedTogether(ctx, candidates.map((m) => m.id), String(db.deletedAt));
  const homes = together.filter((p) => p.fullPageDatabaseId === db.id);
  const rows = together.filter((p) => p.databaseId === db.id);
  return [...homes, ...rows];
}

export const restoreDatabaseInputShape = {
  databaseId: idInput.describe("Trashed database id (see list_trash)"),
  includePages: z.boolean().optional().describe("Also restore its rows and full-page home trashed together with it (default true)"),
};
const restoreDatabaseInput = z.object(restoreDatabaseInputShape);

export async function restoreDatabaseTool(ctx: McpContext, raw: z.input<typeof restoreDatabaseInput>) {
  const input = restoreDatabaseInput.parse(raw);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "write");
  if (!isTrashed(db)) throw new ToolError("This database is not in the trash");
  const workspaceId = String(db.workspaceId);
  const related = input.includePages === false ? [] : await pagesTrashedWithDatabase(ctx, db);
  if (related.some((p) => p.databaseId)) await requireCollabEpoch(ctx);
  // DB 1 + 함께 되살리는 행·홈 페이지 수.
  await beginWrite(ctx, 1 + related.length);
  const restored = await restoreDatabase({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, id: input.databaseId, workspaceId });
  await publishDatabase(restored);
  const pages = await restorePages(ctx, related, workspaceId);
  return { databaseId: input.databaseId, title: restored.title ?? "", restoredPages: pages.map((p) => p.id) };
}

export const trashDatabaseInputShape = { databaseId: idInput.describe("Database to move to the trash (with its rows and full-page home)") };
const trashDatabaseInput = z.object(trashDatabaseInputShape);

type RowPage = { id: string; title: string; databaseId: string; deleted: boolean };

/**
 * DB 의 모든 행 페이지(휴지통 포함)를 byDatabaseAndOrder GSI 로 빠짐없이 읽는다 — 워크스페이스 메타 스캔은
 * MAX_SCANNED_METAS 에서 잘려 큰 워크스페이스에서 행을 놓친다.
 */
export async function databaseRowPages(ctx: McpContext, databaseId: string, workspaceId: string): Promise<RowPage[]> {
  const out: RowPage[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tables.Pages,
        IndexName: "byDatabaseAndOrder",
        KeyConditionExpression: "databaseId = :d",
        ExpressionAttributeValues: { ":d": databaseId },
        ProjectionExpression: "id, workspaceId, title, databaseId, deletedAt",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of (r.Items ?? []) as Item[]) {
      if (typeof it.id !== "string" || it.workspaceId !== workspaceId) continue;
      out.push({ id: it.id, title: String(it.title ?? ""), databaseId, deleted: Boolean(it.deletedAt) });
    }
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

async function trashPage(ctx: McpContext, meta: { id: string; title: string; databaseId: string | null }, workspaceId: string, updatedAt: string) {
  const deleted = await softDeletePage({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    id: meta.id, workspaceId, updatedAt, title: meta.title, databaseId: meta.databaseId,
  });
  await publishPage(deleted, { deletedAt: String(deleted.deletedAt ?? updatedAt) });
}

/**
 * 앱 deleteDatabase 와 같은 범위 — 행 페이지·풀페이지 홈·DB 를 휴지통으로. DB 룸은 건드리지 않는다
 * (DB 자체가 사라지고, restore_database 가 같은 룸 멤버십으로 되살린다).
 */
export async function trashDatabaseTool(ctx: McpContext, raw: z.input<typeof trashDatabaseInput>) {
  const input = trashDatabaseInput.parse(raw);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "write");
  if (isTrashed(db)) throw new ToolError("This database is already in the trash");
  const workspaceId = String(db.workspaceId);
  const rows = (await databaseRowPages(ctx, input.databaseId, workspaceId)).filter((r) => !r.deleted);
  if (rows.length > MAX_TRASH_DATABASE_ROWS) {
    throw new ToolError(`This database has ${rows.length} rows (max ${MAX_TRASH_DATABASE_ROWS} via MCP); delete it in QuickNote`);
  }
  const scan = await scanWorkspaceMetas({ doc: ctx.doc, pagesTable: ctx.tables.Pages, workspaceId, budget: MAX_SCANNED_METAS, fresh: true });
  const homeId = await findDatabaseHomeId(ctx, db, scan.metas);
  // 메타가 잘렸는데 홈을 못 찾았으면 홈이 고아로 남을 수 있으므로 거부한다.
  if (!homeId && scan.truncated) {
    throw new ToolError("This workspace is too large to locate the database's full-page home via MCP; delete it in QuickNote");
  }
  // DB 1 + 행 + 홈 페이지 수.
  await beginWrite(ctx, 1 + rows.length + (homeId ? 1 : 0));
  const updatedAt = nowIso();
  for (const row of rows) await trashPage(ctx, row, workspaceId, updatedAt);
  if (homeId) await trashPage(ctx, { id: homeId, title: String(db.title ?? ""), databaseId: null }, workspaceId, updatedAt);
  const deleted = await softDeleteDatabase({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, id: input.databaseId, workspaceId, updatedAt });
  await publishDatabase(deleted, { deletedAt: String(deleted.deletedAt ?? updatedAt) });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, workspaceId);
  return {
    databaseId: input.databaseId,
    trashedRows: rows.length,
    ...(homeId ? { trashedHomePage: homeId } : {}),
    note: "Moved to trash; restore with restore_database within 30 days",
  };
}
