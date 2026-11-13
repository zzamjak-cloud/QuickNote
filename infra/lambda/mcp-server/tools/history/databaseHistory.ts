// DB 버전 히스토리 — 구조(제목·컬럼·프리셋) 목록·복원, 행 페이지 히스토리 목록.
// 복원은 v5 restoreDatabaseVersion 으로 Databases 를 되돌린 뒤, 시드된 DB 룸(구조 권위)의 columns·presets·panelState 도
// 복원본으로 맞춘다 — 안 그러면 열린 뷰·다음 진입의 룸 materialize 가 옛 구조로 되돌린다. 삭제 행은 자동 복구하지 않는다
// (서버 restoreDatabaseVersion 과 같은 정책 — 행은 list_database_row_history → restore_page_version 또는 restore_page).
import * as Y from "yjs";
import { z } from "zod";
import { jsonToY } from "../../../realtime/dbSeed";
import {
  listDatabaseHistory,
  listDatabaseRowHistory,
  restoreDatabaseVersion,
} from "../../../v5-resolvers/handlers/pageDatabase/history";
import { ToolError, type McpContext } from "../../context";
import { editDbRoom } from "../../dbCollabWriter";
import { findDatabaseHomeId } from "../../dbPath";
import { currentColumns, recordDatabaseCheckpoint } from "../../dbStructureWriter";
import { getItem } from "../../ddb";
import { requireCollabEpoch } from "../../epochGuard";
import { workspaceMetas } from "../../pageHelpers";
import { patchPage } from "../../pageWrite";
import { publishDatabase } from "../../publish";
import { databaseSnapshotExtra, idInput, isTrashed, loadDatabaseAnyState, summarizeHistoryEntry } from "./shared";

type Item = Record<string, unknown>;

const limitInput = z.number().int().min(1).max(100).optional().describe("Max entries, newest first (default 30)");

export const listDatabaseHistoryInputShape = { databaseId: idInput.describe("Database id; trashed databases allowed"), limit: limitInput };
const listDatabaseHistoryInput = z.object(listDatabaseHistoryInputShape);

export async function listDatabaseHistoryTool(ctx: McpContext, raw: z.input<typeof listDatabaseHistoryInput>) {
  const input = listDatabaseHistoryInput.parse(raw);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "read");
  const entries = await listDatabaseHistory({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    databaseId: input.databaseId, workspaceId: String(db.workspaceId), limit: input.limit ?? 30,
  });
  return {
    databaseId: input.databaseId,
    title: db.title ?? "",
    inTrash: isTrashed(db),
    versions: entries.map((e) => summarizeHistoryEntry(e, databaseSnapshotExtra)),
    note: "Restores structure (title, columns, views) only, not deleted rows. Restore with restore_database_version {databaseId, historyId}.",
  };
}

export const listDatabaseRowHistoryInputShape = {
  databaseId: idInput.describe("Database id"),
  limit: limitInput,
  cursor: z.string().max(2048).optional().describe("nextCursor from a previous call"),
};
const listDatabaseRowHistoryInput = z.object(listDatabaseRowHistoryInputShape);

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  try {
    JSON.parse(decoded);
  } catch {
    throw new ToolError("Invalid cursor");
  }
  return decoded;
}

export async function listDatabaseRowHistoryTool(ctx: McpContext, raw: z.input<typeof listDatabaseRowHistoryInput>) {
  const input = listDatabaseRowHistoryInput.parse(raw);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "read");
  const res = await listDatabaseRowHistory({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    databaseId: input.databaseId, workspaceId: String(db.workspaceId), limit: input.limit ?? 30,
    nextToken: decodeCursor(input.cursor),
  });
  return {
    databaseId: input.databaseId,
    entries: res.items.map((e) => summarizeHistoryEntry(e, () => ({ pageId: e.pageId, rowDeleted: e.kind === "page.delete" }))),
    nextCursor: res.nextToken ? Buffer.from(res.nextToken, "utf8").toString("base64url") : null,
    note: "Restore a row (also a deleted one) with restore_page_version {pageId, historyId}.",
  };
}

export const restoreDatabaseVersionInputShape = {
  databaseId: idInput.describe("Database id"),
  historyId: z.string().trim().min(1).max(256).describe("historyId from list_database_history"),
};
const restoreDatabaseVersionInput = z.object(restoreDatabaseVersionInputShape);

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 기존 Y.Array 를 그 자리에서 비우고 채운다(클라 관찰자가 붙은 타입 인스턴스를 유지). */
function replaceArray(root: Y.Map<unknown>, key: string, values: unknown[]): void {
  const current = root.get(key);
  if (current instanceof Y.Array) {
    current.delete(0, current.length);
    current.push(values.map(jsonToY));
  } else {
    root.set(key, jsonToY(values));
  }
}

/** 룸 구조를 복원본과 정확히 같게 — 컬럼이 비면 클라가 미시드로 보고 무시하므로 건드리지 않는다. */
export function restoredStructureMutation(restored: Item) {
  const columns = parseJson(restored.columns);
  const presets = parseJson(restored.presets);
  const panelState = parseJson(restored.panelState);
  return (root: Y.Map<unknown>): void => {
    if (Array.isArray(columns) && columns.length > 0) replaceArray(root, "columns", columns);
    if (Array.isArray(presets)) replaceArray(root, "presets", presets);
    if (panelState && typeof panelState === "object" && !Array.isArray(panelState)) root.set("panelState", jsonToY(panelState));
  };
}

/** 앱 규약: 풀페이지 DB 홈 제목 = DB 제목. 복원으로 이름이 바뀌면 홈도 맞춘다. */
async function syncHomeTitle(ctx: McpContext, before: Item, restored: Item): Promise<string | null> {
  const title = typeof restored.title === "string" ? restored.title : "";
  if (!title || title === before.title) return null;
  const homeId = await findDatabaseHomeId(ctx, before, await workspaceMetas(ctx, String(before.workspaceId)));
  if (homeId) await patchPage(ctx, homeId, { title });
  return homeId;
}

export async function restoreDatabaseVersionTool(ctx: McpContext, raw: z.input<typeof restoreDatabaseVersionInput>) {
  const input = restoreDatabaseVersionInput.parse(raw);
  const db = await loadDatabaseAnyState(ctx, input.databaseId, "write");
  const entry = await getItem(ctx.doc, ctx.tables.DatabaseHistory, { databaseId: input.databaseId, historyId: input.historyId });
  if (!entry || entry.workspaceId !== db.workspaceId) throw new ToolError("Version not found for this database");
  await requireCollabEpoch(ctx);
  // 복원 직전 현재(룸 기준) 구조를 체크포인트로 남겨 복원 자체를 되돌릴 수 있게 한다.
  if (!isTrashed(db)) await recordDatabaseCheckpoint(ctx, db, await currentColumns(ctx, db));

  const restored = await restoreDatabaseVersion({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller,
    input: { databaseId: input.databaseId, workspaceId: String(db.workspaceId), historyId: input.historyId },
  });
  const writtenTo = await editDbRoom(ctx, input.databaseId, restoredStructureMutation(restored));
  await publishDatabase(restored);
  const homePageId = await syncHomeTitle(ctx, db, restored);
  return {
    databaseId: input.databaseId,
    restoredFrom: input.historyId,
    title: restored.title ?? "",
    wasInTrash: isTrashed(db),
    structureWrittenTo: writtenTo,
    ...(homePageId ? { homePageRenamed: homePageId } : {}),
    note: "Deleted rows are not restored by this; use list_database_row_history + restore_page_version or restore_page.",
  };
}
