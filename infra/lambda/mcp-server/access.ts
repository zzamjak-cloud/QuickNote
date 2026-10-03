// 워크스페이스 인가 — (멤버 접근 권한) ∩ (토큰 workspaceIds 범위).
// 토큰 workspaceIds 가 비어 있으면 멤버가 접근 가능한 전체를 허용한다(역할 규칙은 _auth 그대로).
import { hasWorkspaceViewAccess } from "../v5-resolvers/handlers/_auth";
import { ToolError, type McpContext } from "./context";
import { workspaceInfo } from "./workspacePolicy";

/** 존재 여부를 노출하지 않도록 권한 없음과 없음을 같은 문구로 돌려준다. */
export const NOT_ACCESSIBLE = "Not found or not accessible with this token";

export function isWithinTokenScope(ctx: McpContext, workspaceId: string): boolean {
  const scoped = ctx.token.workspaceIds ?? [];
  return scoped.length === 0 || scoped.includes(workspaceId);
}

/**
 * MCP 워크스페이스 인가.
 * - 정책 disabled 면 MCP 에서는 존재하지 않는 것처럼 다룬다(목록·검색·조회 모두 제외, 직접 접근은 not found).
 * - 타인의 개인 워크스페이스는 거부한다 — workspace.ts hydrateWorkspace 와 같은 기준
 *   (Workspaces.type === "personal" 이고 caller.personalWorkspaceId 가 아님). _auth 의 역할 규칙은
 *   developer/owner/leader 에게 모든 워크스페이스를 열어 주지만, 외부 AI 로 나가는 경로에서는 소유자만 읽게 좁힌다.
 */
export async function canAccessWorkspace(ctx: McpContext, workspaceId: string): Promise<boolean> {
  if (!workspaceId || !isWithinTokenScope(ctx, workspaceId)) return false;
  const info = await workspaceInfo(ctx, workspaceId);
  if (info.mcpPolicy === "disabled") return false;
  if (info.type === "personal" && workspaceId !== ctx.caller.personalWorkspaceId) return false;
  return hasWorkspaceViewAccess({
    doc: ctx.doc,
    memberTeamsTableName: ctx.tables.MemberTeams,
    workspaceAccessTableName: ctx.tables.WorkspaceAccess,
    caller: ctx.caller,
    workspaceId,
  });
}

export async function requireWorkspace(ctx: McpContext, workspaceId: string): Promise<void> {
  if (!(await canAccessWorkspace(ctx, workspaceId))) throw new ToolError(NOT_ACCESSIBLE);
}
