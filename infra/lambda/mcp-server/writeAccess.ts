// 쓰기 인가 — (토큰 write scope) ∩ (읽기 인가: 토큰 workspaceIds·개인 WS 규칙) ∩ (멤버 edit 권한).
import {
  LC_SCHEDULER_WORKSPACE_ID,
  ResolverError,
  isLCSchedulerDatabaseId,
  requireWorkspaceAccess,
} from "../v5-resolvers/handlers/_auth";
import { NOT_ACCESSIBLE, requireWorkspace } from "./access";
import { ToolError, type McpContext } from "./context";
import { getItem } from "./ddb";
import { consumeDailyWrite } from "./rateLimit";
import { workspaceInfo } from "./workspacePolicy";

export const WRITE_SCOPE_ERROR = "token lacks write scope";
export const EDIT_ACCESS_ERROR = "Edit access to this workspace is required";
export const READ_ONLY_POLICY_ERROR = "workspace MCP policy is read-only";

type Item = Record<string, unknown>;

export function requireWriteScope(ctx: McpContext): void {
  if (!(ctx.token.scopes ?? []).includes("write")) throw new ToolError(WRITE_SCOPE_ERROR);
}

/** 쓰기 대상 워크스페이스 인가. 스케줄러 가상 WS 는 MCP 쓰기 대상이 아니다. */
export async function requireWritableWorkspace(ctx: McpContext, workspaceId: string): Promise<void> {
  requireWriteScope(ctx);
  if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) throw new ToolError(NOT_ACCESSIBLE);
  await requireWorkspace(ctx, workspaceId);
  // 워크스페이스 관리자가 MCP 를 읽기 전용으로 둔 곳은 모든 쓰기 툴을 거부한다.
  if ((await workspaceInfo(ctx, workspaceId)).mcpPolicy === "read") throw new ToolError(READ_ONLY_POLICY_ERROR);
  try {
    await requireWorkspaceAccess({
      doc: ctx.doc,
      memberTeamsTableName: ctx.tables.MemberTeams,
      workspaceAccessTableName: ctx.tables.WorkspaceAccess,
      caller: ctx.caller,
      workspaceId,
      required: "edit",
    });
  } catch (err) {
    if (err instanceof ResolverError) throw new ToolError(EDIT_ACCESS_ERROR);
    throw err;
  }
}

/** 쓰기 가능한(휴지통 아님) 페이지. 없음·권한 없음은 같은 문구로 숨긴다. */
export async function loadWritablePage(ctx: McpContext, pageId: string): Promise<Item> {
  requireWriteScope(ctx);
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: pageId });
  if (!page) throw new ToolError(NOT_ACCESSIBLE);
  await requireWritableWorkspace(ctx, String(page.workspaceId ?? ""));
  if (page.deletedAt) throw new ToolError("This page is in the trash. Restore it in QuickNote before editing.");
  return page;
}

export async function loadWritableDatabase(ctx: McpContext, databaseId: string): Promise<Item> {
  requireWriteScope(ctx);
  if (isLCSchedulerDatabaseId(databaseId)) throw new ToolError(NOT_ACCESSIBLE);
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id: databaseId });
  if (!db) throw new ToolError(NOT_ACCESSIBLE);
  await requireWritableWorkspace(ctx, String(db.workspaceId ?? ""));
  if (db.deletedAt) throw new ToolError("This database is in the trash.");
  return db;
}

/**
 * 쓰기 툴 공통 관문 — write scope 확인 후 일일 쓰기 상한을 쓰는 페이지 수(units)만큼 소비한다
 * (read 토큰은 카운터를 올리지 않는다).
 * 워크스페이스·대상별 인가는 각 툴이 이어서 수행한다.
 */
export async function beginWrite(ctx: McpContext, units = 1): Promise<void> {
  requireWriteScope(ctx);
  const quota = await consumeDailyWrite({ doc: ctx.doc, tableName: ctx.tables.RateLimit, tokenId: ctx.token.tokenId, units });
  if (!quota.ok) {
    throw new ToolError(`Daily write limit reached (${quota.limit} page writes per token per UTC day). Resets at ${quota.resetAt}.`);
  }
}
