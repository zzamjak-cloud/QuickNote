// 워크스페이스 생성·수정 — v5 workspace 핸들러(createWorkspace·updateWorkspace)를 그대로 써 역할 규칙(매니저 이상)을 유지한다.
// 삭제·보관은 노출하지 않는다.
//
// 토큰 범위: workspaceIds 가 지정된(범위 한정) 토큰은 워크스페이스를 만들 수 없다. 새 워크스페이스를 쓰려면 토큰 범위를
// 넓혀야 하는데, 범위는 사람이 토큰 설정(PAT 생성·OAuth 동의)에서만 넓힌다 — MCP Lambda 는 토큰 테이블에서
// lastUsedAt 외 속성을 쓸 수 없게 IAM 으로 막혀 있다. 만들고 쓰지 못하는 워크스페이스를 남기지 않도록 생성 자체를 거부한다.
import { z } from "zod";
import { createWorkspace, updateWorkspace } from "../../../v5-resolvers/handlers/workspace";
import { ToolError, type McpContext } from "../../context";
import { requireWritableWorkspace, requireWriteScope } from "../../writeAccess";
import { idInput } from "../history/shared";

export const SCOPED_TOKEN_CREATE_ERROR =
  "This token is limited to specific workspaces, so a new workspace would not be usable with it. " +
  "Create the workspace in QuickNote, or use a token that is not limited to specific workspaces.";

/** v5 createWorkspace 의 access 엔트리 상한(24) — 생성자 본인 edit 엔트리 1개를 항상 더한다. */
const MAX_EXTRA_ACCESS = 23;

const nameInput = z.string().trim().min(1).max(100);
const optionListInput = z.array(z.string().trim().min(1).max(64)).max(100);

const accessEntryInput = z
  .object({
    subjectType: z.enum(["member", "team", "everyone"]),
    subjectId: z.string().trim().min(1).max(128).optional().describe("memberId or teamId (omit for everyone)"),
    level: z.enum(["edit", "view"]),
  })
  .refine((e) => e.subjectType === "everyone" || Boolean(e.subjectId), { message: "subjectId is required for member/team" });

type AccessEntry = z.infer<typeof accessEntryInput>;
type ResolverAccess = { subjectType: "MEMBER" | "TEAM" | "EVERYONE"; subjectId?: string | null; level: "EDIT" | "VIEW" };

function toResolverAccess(entries: AccessEntry[], callerMemberId: string): ResolverAccess[] {
  // 생성자 본인은 항상 edit — 매니저는 역할만으로 접근권이 없어(hydrateWorkspace) 엔트리가 없으면 만든 WS 를 못 연다.
  const others = entries.filter((e) => !(e.subjectType === "member" && e.subjectId === callerMemberId));
  const unique = new Map<string, AccessEntry>();
  for (const e of others) unique.set(`${e.subjectType}#${e.subjectId ?? "*"}`, e);
  return [
    { subjectType: "MEMBER", subjectId: callerMemberId, level: "EDIT" },
    ...[...unique.values()].map((e) => ({
      subjectType: e.subjectType.toUpperCase() as ResolverAccess["subjectType"],
      subjectId: e.subjectType === "everyone" ? null : (e.subjectId ?? null),
      level: e.level === "edit" ? ("EDIT" as const) : ("VIEW" as const),
    })),
  ];
}

function workspaceView(ws: Record<string, unknown>) {
  const options = (ws.options ?? {}) as Record<string, unknown>;
  return {
    workspaceId: ws.workspaceId,
    name: ws.name,
    type: ws.type,
    mcpPolicy: ws.mcpPolicy,
    access: ws.access,
    jobFunctions: options.jobFunctions ?? [],
    jobTitles: options.jobTitles ?? [],
  };
}

export const createWorkspaceInputShape = {
  name: nameInput.describe("Workspace name"),
  access: z
    .array(accessEntryInput)
    .max(MAX_EXTRA_ACCESS)
    .optional()
    .describe("Extra access entries (see get_users for member ids). The token owner always gets edit access."),
};
const createWorkspaceInput = z.object(createWorkspaceInputShape);

export async function createWorkspaceTool(ctx: McpContext, raw: z.input<typeof createWorkspaceInput>) {
  const input = createWorkspaceInput.parse(raw);
  requireWriteScope(ctx);
  if ((ctx.token.workspaceIds ?? []).length > 0) throw new ToolError(SCOPED_TOKEN_CREATE_ERROR);
  const created = await createWorkspace({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: { name: input.name, access: toResolverAccess(input.access ?? [], ctx.caller.memberId) },
  });
  return {
    ...workspaceView(created as unknown as Record<string, unknown>),
    note: "Created. Open QuickNote's workspace list (or reload) to see it in the app.",
  };
}

export const updateWorkspaceInputShape = {
  workspaceId: idInput.describe("Workspace id (see list_workspaces)"),
  name: nameInput.optional().describe("New name"),
  jobFunctions: optionListInput.optional().describe("Replace the workspace's job-function option list"),
  jobTitles: optionListInput.optional().describe("Replace the workspace's job-title option list"),
};
const updateWorkspaceInput = z.object(updateWorkspaceInputShape);

export async function updateWorkspaceTool(ctx: McpContext, raw: z.input<typeof updateWorkspaceInput>) {
  const input = updateWorkspaceInput.parse(raw);
  if (input.name === undefined && input.jobFunctions === undefined && input.jobTitles === undefined) {
    throw new ToolError("Nothing to update: pass name, jobFunctions or jobTitles");
  }
  await requireWritableWorkspace(ctx, input.workspaceId);
  const options =
    input.jobFunctions !== undefined || input.jobTitles !== undefined
      ? { jobFunctions: input.jobFunctions ?? null, jobTitles: input.jobTitles ?? null }
      : null;
  const updated = await updateWorkspace({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: { workspaceId: input.workspaceId, name: input.name ?? null, options },
    // Workspaces 쓰기 IAM 이 name·jobFunctions·jobTitles 속성으로 제한돼 있다.
    returnValues: "UPDATED_NEW",
  });
  return workspaceView(updated as unknown as Record<string, unknown>);
}
