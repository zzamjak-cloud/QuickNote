// AppSync Lambda 리졸버 라우터. ctx.info.fieldName 으로 분기.
// 각 핸들러는 handlers/ 아래에 분리. 본 파일은 라우팅 + 공통 에러 응답만.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getCallerMember, ResolverError } from "./handlers/_auth";
import {
  createMember,
  listMembers,
  getMember,
  updateMember,
  updateMyClientPrefs,
  promoteToManager,
  demoteToMember,
  transferOwnership,
  removeMember,
  restoreMember,
  assignMemberToTeam,
  unassignMemberFromTeam,
} from "./handlers/member";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
  archiveTeam,
  restoreTeam,
} from "./handlers/team";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMyWorkspaces,
  setWorkspaceAccess,
  updateWorkspace,
  archiveWorkspace,
  restoreWorkspace,
} from "./handlers/workspace";
import { searchMembersForMention } from "./handlers/mention";
import {
  listDatabases,
  listPages,
  listTrashedPages,
  restorePage,
  softDeleteDatabase,
  softDeletePage,
  upsertDatabase,
  upsertPage,
  validateWorkspaceSubscription,
} from "./handlers/pageDatabase";
import {
  listComments,
  upsertComment,
  softDeleteComment,
} from "./handlers/commentDatabase";
import type { Tables, UpdateMemberInput } from "./handlers/member";

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

const tables: Tables = {
  Members: process.env.MEMBERS_TABLE_NAME!,
  Teams: process.env.TEAMS_TABLE_NAME!,
  MemberTeams: process.env.MEMBER_TEAMS_TABLE_NAME!,
  Workspaces: process.env.WORKSPACES_TABLE_NAME!,
  WorkspaceAccess: process.env.WORKSPACE_ACCESS_TABLE_NAME!,
  Pages: process.env.PAGES_TABLE_NAME,
  Databases: process.env.DATABASES_TABLE_NAME,
  Comments: process.env.COMMENTS_TABLE_NAME,
};

type AppsyncEvent = {
  arguments: Record<string, unknown>;
  identity?: { sub?: string };
  info: { fieldName: string };
};

function roleToGql(role: string): "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER" {
  if (role === "developer") return "DEVELOPER";
  if (role === "owner") return "OWNER";
  if (role === "leader") return "LEADER";
  if (role === "manager") return "MANAGER";
  return "MEMBER";
}

function statusToGql(status: string): "ACTIVE" | "REMOVED" {
  return status === "removed" ? "REMOVED" : "ACTIVE";
}

function workspaceTypeToGql(type: string): "PERSONAL" | "SHARED" {
  return type === "personal" ? "PERSONAL" : "SHARED";
}

function levelToGql(level: string): "EDIT" | "VIEW" {
  return level === "edit" ? "EDIT" : "VIEW";
}

function subjectTypeToGql(type: string): "TEAM" | "MEMBER" | "EVERYONE" {
  if (type === "team") return "TEAM";
  if (type === "member") return "MEMBER";
  return "EVERYONE";
}

function normalizeMemberForGql(member: Record<string, unknown>) {
  return {
    ...member,
    workspaceRole: roleToGql(String(member.workspaceRole ?? "member")),
    status: statusToGql(String(member.status ?? "active")),
  };
}

function normalizeWorkspaceForGql(workspace: Record<string, unknown>) {
  const access = Array.isArray(workspace.access) ? workspace.access : [];
  return {
    ...workspace,
    type: workspaceTypeToGql(String(workspace.type ?? "shared")),
    myEffectiveLevel: levelToGql(String(workspace.myEffectiveLevel ?? "view")),
    access: access.map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        ...e,
        subjectType: subjectTypeToGql(String(e.subjectType ?? "everyone")),
        level: levelToGql(String(e.level ?? "view")),
      };
    }),
  };
}

function normalizeTeamForGql(team: Record<string, unknown>) {
  const members = Array.isArray(team.members) ? team.members : [];
  return {
    ...team,
    members: members.map((m) => normalizeMemberForGql(m as Record<string, unknown>)),
  };
}

export async function handler(event: AppsyncEvent): Promise<unknown> {
  try {
    const caller = await getCallerMember(doc, tables.Members, event.identity?.sub);
    const base = { doc, tables, caller };

    switch (event.info.fieldName) {
      case "me":
        return normalizeMemberForGql(caller as unknown as Record<string, unknown>);
      case "createMember":
        return normalizeMemberForGql((await createMember({
          ...base,
          input: event.arguments.input as import("./handlers/member").CreateMemberInput,
        })) as Record<string, unknown>);
      case "listMembers":
        return (await listMembers({
          ...base,
          filter: event.arguments.filter as
            | { status?: "ACTIVE" | "REMOVED"; teamId?: string; workspaceRole?: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER" }
            | undefined,
        })).map((m) => normalizeMemberForGql(m as unknown as Record<string, unknown>));
      case "getMember":
        {
          const member = await getMember({ ...base, memberId: event.arguments.memberId as string });
          return member ? normalizeMemberForGql(member as unknown as Record<string, unknown>) : null;
        }
      case "updateMember":
        return normalizeMemberForGql((await updateMember({ ...base, input: event.arguments.input as UpdateMemberInput & { memberId: string } })) as Record<string, unknown>);
      case "updateMyClientPrefs": {
        const raw = event.arguments.input as { clientPrefs?: unknown };
        const cp =
          typeof raw?.clientPrefs === "string"
            ? raw.clientPrefs
            : JSON.stringify(raw.clientPrefs ?? {});
        return normalizeMemberForGql(
          (await updateMyClientPrefs({
            ...base,
            input: { clientPrefs: cp },
          })) as Record<string, unknown>,
        );
      }
      case "promoteToManager":
        return normalizeMemberForGql((await promoteToManager({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>);
      case "demoteToMember":
        return normalizeMemberForGql((await demoteToMember({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>);
      case "transferOwnership":
        return normalizeMemberForGql((await transferOwnership({ ...base, toMemberId: event.arguments.toMemberId as string })) as Record<string, unknown>);
      case "removeMember":
        return normalizeMemberForGql((await removeMember({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>);
      case "restoreMember":
        return normalizeMemberForGql((await restoreMember({
          ...base,
          memberId: event.arguments.memberId as string,
        })) as Record<string, unknown>);
      case "assignMemberToTeam":
        await assignMemberToTeam({ ...base, memberId: event.arguments.memberId as string, teamId: event.arguments.teamId as string });
        return true;
      case "unassignMemberFromTeam":
        await unassignMemberFromTeam({ ...base, memberId: event.arguments.memberId as string, teamId: event.arguments.teamId as string });
        return true;
      case "listTeams":
        return (await listTeams(base)).map((t) => normalizeTeamForGql(t as unknown as Record<string, unknown>));
      case "getTeam":
        {
          const team = await getTeam({ ...base, teamId: event.arguments.teamId as string });
          return team ? normalizeTeamForGql(team as unknown as Record<string, unknown>) : null;
        }
      case "createTeam":
        return normalizeTeamForGql((await createTeam({ ...base, name: event.arguments.name as string })) as Record<string, unknown>);
      case "updateTeam":
        return normalizeTeamForGql((await updateTeam({
          ...base,
          teamId: event.arguments.teamId as string,
          name: event.arguments.name as string,
        })) as Record<string, unknown>);
      case "deleteTeam":
        return await deleteTeam({ ...base, teamId: event.arguments.teamId as string });
      case "archiveTeam":
        return normalizeTeamForGql(await archiveTeam({ ...base, teamId: event.arguments.teamId as string }) as Record<string, unknown>);
      case "restoreTeam":
        return normalizeTeamForGql(await restoreTeam({ ...base, teamId: event.arguments.teamId as string }) as Record<string, unknown>);
      case "createWorkspace":
        return normalizeWorkspaceForGql((await createWorkspace({
          ...base,
          input: event.arguments.input as { name: string; access: Array<{ subjectType: "MEMBER" | "TEAM" | "EVERYONE"; subjectId?: string; level: "EDIT" | "VIEW" }> },
        })) as Record<string, unknown>);
      case "updateWorkspace":
        return normalizeWorkspaceForGql((await updateWorkspace({
          ...base,
          input: event.arguments.input as { workspaceId: string; name?: string | null },
        })) as Record<string, unknown>);
      case "setWorkspaceAccess":
        return normalizeWorkspaceForGql((await setWorkspaceAccess({
          ...base,
          workspaceId: event.arguments.workspaceId as string,
          entries: event.arguments.entries as Array<{ subjectType: "MEMBER" | "TEAM" | "EVERYONE"; subjectId?: string; level: "EDIT" | "VIEW" }>,
        })) as Record<string, unknown>);
      case "deleteWorkspace":
        return await deleteWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string });
      case "archiveWorkspace":
        return normalizeWorkspaceForGql(await archiveWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string }) as Record<string, unknown>);
      case "restoreWorkspace":
        return normalizeWorkspaceForGql(await restoreWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string }) as Record<string, unknown>);
      case "listMyWorkspaces":
        return (await listMyWorkspaces(base)).map((w) => normalizeWorkspaceForGql(w as unknown as Record<string, unknown>));
      case "getWorkspace":
        {
          const ws = await getWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string });
          return ws ? normalizeWorkspaceForGql(ws as unknown as Record<string, unknown>) : null;
        }
      case "searchMembersForMention":
        return await searchMembersForMention({
          ...base,
          query: (event.arguments.query as string | null | undefined) ?? null,
          limit: (event.arguments.limit as number | null | undefined) ?? null,
        });
      case "listPages":
        return await listPages({
          ...base,
          workspaceId: event.arguments.workspaceId as string,
          updatedAfter: event.arguments.updatedAfter as string | undefined,
          limit: event.arguments.limit as number | undefined,
          nextToken: event.arguments.nextToken as string | undefined,
        });
      case "listDatabases":
        return await listDatabases({
          ...base,
          workspaceId: event.arguments.workspaceId as string,
          updatedAfter: event.arguments.updatedAfter as string | undefined,
          limit: event.arguments.limit as number | undefined,
          nextToken: event.arguments.nextToken as string | undefined,
        });
      case "listTrashedPages":
        return await listTrashedPages({
          ...base,
          workspaceId: event.arguments.workspaceId as string,
          limit: event.arguments.limit as number | undefined,
          nextToken: event.arguments.nextToken as string | null | undefined,
        });
      case "upsertPage":
        return await upsertPage({ ...base, input: event.arguments.input as Record<string, unknown> });
      case "softDeletePage":
        return await softDeletePage({
          ...base,
          id: event.arguments.id as string,
          workspaceId: event.arguments.workspaceId as string,
          updatedAt: event.arguments.updatedAt as string,
        });
      case "restorePage":
        return await restorePage({
          ...base,
          id: event.arguments.id as string,
          workspaceId: event.arguments.workspaceId as string,
        });
      case "upsertDatabase":
        return await upsertDatabase({ ...base, input: event.arguments.input as Record<string, unknown> });
      case "softDeleteDatabase":
        return await softDeleteDatabase({
          ...base,
          id: event.arguments.id as string,
          workspaceId: event.arguments.workspaceId as string,
          updatedAt: event.arguments.updatedAt as string,
        });
      case "listComments":
        return await listComments({
          ...base,
          workspaceId: event.arguments.workspaceId as string,
          updatedAfter: event.arguments.updatedAfter as string | undefined,
          limit: event.arguments.limit as number | undefined,
          nextToken: event.arguments.nextToken as string | undefined,
        });
      case "upsertComment":
        return await upsertComment({ ...base, input: event.arguments.input as Record<string, unknown> });
      case "softDeleteComment":
        return await softDeleteComment({
          ...base,
          id: event.arguments.id as string,
          workspaceId: event.arguments.workspaceId as string,
          updatedAt: event.arguments.updatedAt as string,
        });
      case "onCommentChanged":
        return await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string });
      case "onPageChanged":
        return await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string });
      case "onDatabaseChanged":
        return await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string });
      default:
        throw new ResolverError(`unknown fieldName: ${event.info.fieldName}`, "InternalError");
    }
  } catch (err) {
    if (err instanceof ResolverError) {
      return errorResponse(err.message, err.errorType);
    }
    console.error("v5-resolvers unexpected error", err);
    return errorResponse(
      err instanceof Error ? err.message : String(err),
      "InternalError",
    );
  }
}

function errorResponse(message: string, errorType: string) {
  // AppSync Lambda 리졸버는 errorType/data 필드 형태로 에러 노출 가능.
  // 또는 resolver mapping template 에서 $util.error() 처리.
  // 가장 단순한 방식: throw 해서 AppSync 가 errors 배열에 담도록.
  const e = new Error(message) as Error & { errorType: string };
  e.errorType = errorType;
  throw e;
}
