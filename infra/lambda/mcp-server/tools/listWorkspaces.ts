// list_workspaces — 토큰으로 접근 가능한 워크스페이스 목록.
import {
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
} from "../../../../src/lib/scheduler/schedulerSchema";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../v5-resolvers/handlers/_auth";
import { listMyWorkspaces } from "../../v5-resolvers/handlers/workspace";
import { isWithinTokenScope } from "../access";
import type { McpContext } from "../context";

/** 스케줄러 고정 DB id — 검색·사이드바에 노출되지 않아 에이전트가 스스로 찾을 수 없으므로 목록에 함께 싣는다. */
export const SCHEDULER_DATABASES = {
  tasks: LC_SCHEDULER_DATABASE_ID,
  milestones: LC_MILESTONE_DATABASE_ID,
  features: LC_FEATURE_DATABASE_ID,
} as const;

export type WorkspaceSummary = {
  id: string;
  name: string;
  type: "personal" | "shared";
  access: "edit" | "view";
  /** MCP 허용 정책: read = 이 워크스페이스는 MCP 쓰기 불가. disabled 는 목록에서 제외된다. */
  mcpPolicy: "read" | "readWrite";
  /** 스케줄러 워크스페이스에만 붙는다. */
  schedulerDatabases?: typeof SCHEDULER_DATABASES;
};

type ListArgs = Parameters<typeof listMyWorkspaces>[0];
type ListedWorkspace = Awaited<ReturnType<typeof listMyWorkspaces>>[number];

/**
 * listMyWorkspaces + 스케줄러 가상 WS 보정. 스케줄러 WS 는 Workspaces 행이 없을 수 있어(클라는 가상 WS 로 다룸)
 * 그대로면 목록·OAuth 동의 화면에서 빠진다. 모든 활성 멤버가 edit 이므로(_auth.ts) 행이 없으면 합성한다.
 */
export async function listWorkspacesWithScheduler(args: ListArgs): Promise<ListedWorkspace[]> {
  const all = await listMyWorkspaces(args);
  if (all.some((w) => w.workspaceId === LC_SCHEDULER_WORKSPACE_ID)) return all;
  const scheduler = {
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    name: "스케줄러",
    type: "shared",
    myEffectiveLevel: "edit",
    mcpPolicy: "readWrite",
  } as unknown as ListedWorkspace;
  return [...all, scheduler];
}

export async function accessibleWorkspaces(ctx: McpContext): Promise<WorkspaceSummary[]> {
  const all = await listWorkspacesWithScheduler({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller });
  return all
    .filter((w) => !w.removedAt && isWithinTokenScope(ctx, w.workspaceId) && w.mcpPolicy !== "disabled")
    .map((w) => ({
      id: w.workspaceId,
      name: w.name,
      type: w.type,
      access: w.myEffectiveLevel,
      mcpPolicy: w.mcpPolicy === "read" ? "read" : "readWrite",
      ...(w.workspaceId === LC_SCHEDULER_WORKSPACE_ID ? { schedulerDatabases: SCHEDULER_DATABASES } : {}),
    }));
}

export async function listWorkspacesTool(ctx: McpContext): Promise<{ workspaces: WorkspaceSummary[] }> {
  return { workspaces: await accessibleWorkspaces(ctx) };
}
