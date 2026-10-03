// list_workspaces — 토큰으로 접근 가능한 워크스페이스 목록.
import { listMyWorkspaces } from "../../v5-resolvers/handlers/workspace";
import { isWithinTokenScope } from "../access";
import type { McpContext } from "../context";

export type WorkspaceSummary = {
  id: string;
  name: string;
  type: "personal" | "shared";
  access: "edit" | "view";
  /** MCP 허용 정책: read = 이 워크스페이스는 MCP 쓰기 불가. disabled 는 목록에서 제외된다. */
  mcpPolicy: "read" | "readWrite";
};

export async function accessibleWorkspaces(ctx: McpContext): Promise<WorkspaceSummary[]> {
  const all = await listMyWorkspaces({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller });
  return all
    .filter((w) => !w.removedAt && isWithinTokenScope(ctx, w.workspaceId) && w.mcpPolicy !== "disabled")
    .map((w) => ({
      id: w.workspaceId,
      name: w.name,
      type: w.type,
      access: w.myEffectiveLevel,
      mcpPolicy: w.mcpPolicy === "read" ? "read" : "readWrite",
    }));
}

export async function listWorkspacesTool(ctx: McpContext): Promise<{ workspaces: WorkspaceSummary[] }> {
  return { workspaces: await accessibleWorkspaces(ctx) };
}
