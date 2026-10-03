// list_workspaces — 토큰으로 접근 가능한 워크스페이스 목록.
import { listMyWorkspaces } from "../../v5-resolvers/handlers/workspace";
import { isWithinTokenScope } from "../access";
import type { McpContext } from "../context";

export type WorkspaceSummary = {
  id: string;
  name: string;
  type: "personal" | "shared";
  access: "edit" | "view";
};

export async function accessibleWorkspaces(ctx: McpContext): Promise<WorkspaceSummary[]> {
  const all = await listMyWorkspaces({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller });
  return all
    .filter((w) => !w.removedAt && isWithinTokenScope(ctx, w.workspaceId))
    .map((w) => ({ id: w.workspaceId, name: w.name, type: w.type, access: w.myEffectiveLevel }));
}

export async function listWorkspacesTool(ctx: McpContext): Promise<{ workspaces: WorkspaceSummary[] }> {
  return { workspaces: await accessibleWorkspaces(ctx) };
}
