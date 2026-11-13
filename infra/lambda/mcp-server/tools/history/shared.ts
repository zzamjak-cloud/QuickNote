// 히스토리·휴지통 툴 공용 — 휴지통 상태까지 포함한 대상 로드·인가, 파괴적 작업 확인 플래그, 히스토리 엔트리 요약.
import { z } from "zod";
import { isLCSchedulerDatabaseId } from "../../../v5-resolvers/handlers/_auth";
import { NOT_ACCESSIBLE, requireWorkspace } from "../../access";
import { ToolError, type McpContext } from "../../context";
import { batchGetByKey, getItem } from "../../ddb";
import { requireWritableWorkspace, requireWriteScope } from "../../writeAccess";

type Item = Record<string, unknown>;
export type Access = "read" | "write";

export const CONFIRM_REQUIRED =
  "This permanently deletes data and cannot be undone. Re-run with confirm: true only after the user explicitly approved it.";

/** 스케줄러가 관리하는 보호 DB — 앱 isProtectedDatabaseId 와 같은 범위(삭제·복원·영구삭제 대상 아님). */
const PROTECTED_DB_PREFIXES = ["lc-scheduler-db:", "lc-milestone-db:", "lc-feature-db:"];

export const confirmInput = z.boolean().optional()
  .describe("Must be true. Set it only after the user explicitly approved this irreversible deletion");

export const idInput = z.string().trim().min(1).max(256);

export function requireConfirm(confirm: boolean | undefined): void {
  if (confirm !== true) throw new ToolError(CONFIRM_REQUIRED);
}

export function isTrashed(item: Item): boolean {
  return typeof item.deletedAt === "string" && item.deletedAt !== "";
}

/** 워크스페이스 인가 — 읽기는 토큰 범위·MCP 정책·view, 쓰기는 write scope·정책·edit. */
export async function requireWorkspaceFor(ctx: McpContext, workspaceId: string, access: Access): Promise<void> {
  if (access === "write") await requireWritableWorkspace(ctx, workspaceId);
  else await requireWorkspace(ctx, workspaceId);
}

/** 휴지통 상태를 포함한 페이지. 없음·권한 없음은 같은 문구로 숨긴다. */
export async function loadPageAnyState(ctx: McpContext, pageId: string, access: Access): Promise<Item> {
  if (access === "write") requireWriteScope(ctx);
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: pageId });
  if (!page) throw new ToolError(NOT_ACCESSIBLE);
  await requireWorkspaceFor(ctx, String(page.workspaceId ?? ""), access);
  return page;
}

/** 휴지통 상태를 포함한 DB. 쓰기는 스케줄러 보호 DB 를 거부한다. */
export async function loadDatabaseAnyState(ctx: McpContext, databaseId: string, access: Access): Promise<Item> {
  if (access === "write") {
    requireWriteScope(ctx);
    if (isLCSchedulerDatabaseId(databaseId) || PROTECTED_DB_PREFIXES.some((p) => databaseId.startsWith(p))) {
      throw new ToolError("This database is managed by the scheduler and cannot be changed via MCP");
    }
  }
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id: databaseId });
  if (!db) throw new ToolError(NOT_ACCESSIBLE);
  await requireWorkspaceFor(ctx, String(db.workspaceId ?? ""), access);
  return db;
}

function parseObject(value: unknown): Item | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Item) : null;
}

export function historySnapshot(entry: Item): Item | null {
  return parseObject(entry.snapshot) ?? parseObject(entry.anchor);
}

function contributorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((c) => (c && typeof c === "object" ? String((c as Item).name ?? (c as Item).memberId ?? "") : ""))
    .filter(Boolean);
}

function arrayLength(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** 히스토리 엔트리 요약 — 스냅샷 본문은 싣지 않는다(크기). */
export function summarizeHistoryEntry(entry: Item, extra: (snapshot: Item | null) => Item = () => ({})): Item {
  const snapshot = historySnapshot(entry);
  const units = Array.isArray(entry.changedUnits) ? entry.changedUnits.length : 0;
  return {
    historyId: entry.historyId,
    kind: entry.kind,
    createdAt: entry.createdAt ?? entry.sessionStartedAt ?? null,
    lastActivityAt: entry.lastActivityAt ?? null,
    editedBy: entry.createdByName ?? entry.createdByMemberId ?? null,
    contributors: contributorNames(entry.contributors),
    changedUnits: units,
    title: snapshot && typeof snapshot.title === "string" ? snapshot.title : null,
    ...extra(snapshot),
  };
}

export function databaseSnapshotExtra(snapshot: Item | null): Item {
  return {
    columns: snapshot ? arrayLength(snapshot.columns) : null,
    rows: snapshot ? arrayLength(snapshot.rowPageOrder) : null,
  };
}

/** 앵커 삭제 시각과 같은 작업으로 함께 휴지통에 들어간 것으로 보는 시간 창(앱 연쇄 삭제는 동기화 큐로 수 초 벌어진다). */
const TRASHED_TOGETHER_MS = 10 * 60 * 1000;

/** ids 중 앵커와 함께 휴지통에 들어간(삭제 시각이 창 안인) 페이지. */
export async function pagesTrashedTogether(ctx: McpContext, ids: string[], anchorDeletedAt: string): Promise<Item[]> {
  if (ids.length === 0) return [];
  const anchor = Date.parse(anchorDeletedAt);
  if (!Number.isFinite(anchor)) return [];
  const items = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids,
    projection: "id, workspaceId, title, databaseId, fullPageDatabaseId, deletedAt",
  });
  return items.filter((p) => {
    const at = typeof p.deletedAt === "string" ? Date.parse(p.deletedAt) : NaN;
    return Number.isFinite(at) && Math.abs(at - anchor) <= TRASHED_TOGETHER_MS;
  });
}
