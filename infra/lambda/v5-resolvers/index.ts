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
  setMemberRole,
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
  createOrganization,
  deleteOrganization,
  listOrganizations,
  updateOrganization,
  assignMemberToOrganization,
  unassignMemberFromOrganization,
  archiveOrganization,
  restoreOrganization,
} from "./handlers/organization";
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
  getFlowchart,
  listFlowcharts,
  upsertFlowchart,
  softDeleteFlowchart,
  saveFlowchartVersion,
  listFlowchartHistory,
} from "./handlers/flowchart";
import {
  emptyTrash,
  deleteDatabaseHistoryEvents,
  deletePageHistoryEvents,
  getDatabase,
  getPage,
  getPageById,
  listDatabases,
  listDatabaseHistory,
  listDatabaseRows,
  listDatabaseRowHistory,
  listPageMetas,
  listPageHistory,
  listPages,
  listTrashedPages,
  listTrashedDatabases,
  permanentlyDeleteDatabase,
  permanentlyDeletePage,
  restorePage,
  restoreDatabase,
  restoreDatabaseVersion,
  restorePageVersion,
  savePageVersion,
  saveDatabaseVersion,
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
import { listMyNotifications, markNotificationRead, deleteMyNotification } from "./handlers/notification";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "./handlers/schedule";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "./handlers/project";
import {
  listHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from "./handlers/holiday";
import {
  listMmEntries,
  listMmRevisions,
  upsertMmEntry,
  reviewMmEntry,
  setMmEntryLock,
} from "./handlers/mm";
import {
  listMyAssets,
  renameAsset,
  getAssetUsages,
  deleteMyAssets,
  replaceAssetRef,
  migrateAssetUsage,
  type ListMyAssetsInput,
} from "./handlers/asset";
import {
  listCustomIcons,
  createCustomIcon,
  deleteCustomIcon,
} from "./handlers/customIcon";
import { getWorkspaceMeta } from "./handlers/workspaceMeta";
import {
  getWorkspaceAiConfig,
  setWorkspaceAiKey,
  clearWorkspaceAiKey,
  updateWorkspaceAiSettings,
} from "./handlers/aiConfig";
import { getWorkspaceAiUsage } from "./handlers/aiUsage";
import {
  publishPage,
  unpublishPage,
  getPagePublishStatus,
} from "./handlers/publishedPage";
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
  Flowcharts: process.env.FLOWCHARTS_TABLE_NAME,
  FlowchartHistory: process.env.FLOWCHART_HISTORY_TABLE_NAME,
  Comments: process.env.COMMENTS_TABLE_NAME,
  Notifications: process.env.NOTIFICATIONS_TABLE_NAME,
  // 조직(실) 관련 테이블 — CDK 배포 후 env 주입
  Organizations: process.env.ORGANIZATIONS_TABLE_NAME,
  MemberOrganizations: process.env.MEMBER_ORGANIZATIONS_TABLE_NAME,
  Schedules: process.env.SCHEDULES_TABLE_NAME,
  Projects: process.env.PROJECTS_TABLE_NAME,
  Holidays: process.env.HOLIDAYS_TABLE_NAME,
  MmEntries: process.env.MM_ENTRIES_TABLE_NAME,
  ImageAssets: process.env.IMAGE_ASSETS_TABLE_NAME,
  AssetUsage: process.env.ASSET_USAGE_TABLE_NAME,
  PublishedPages: process.env.PUBLISHED_PAGES_TABLE_NAME,
  ImagesBucketName: process.env.IMAGES_BUCKET_NAME,
  CustomIcons: process.env.CUSTOM_ICONS_TABLE_NAME,
  PageHistory: process.env.PAGE_HISTORY_TABLE_NAME,
  DatabaseHistory: process.env.DATABASE_HISTORY_TABLE_NAME,
  DatabaseRowMembers: process.env.DATABASE_ROW_MEMBERS_TABLE_NAME,
  WorkspaceAiConfig: process.env.WORKSPACE_AI_CONFIG_TABLE_NAME,
  AiUsage: process.env.AI_USAGE_TABLE_NAME,
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
    leaderMemberIds: Array.isArray(team.leaderMemberIds) ? team.leaderMemberIds : [],
    members: members.map((m) => normalizeMemberForGql(m as Record<string, unknown>)),
  };
}

function normalizeOrgForGql(org: Record<string, unknown>) {
  const members = Array.isArray(org.members) ? org.members : [];
  return {
    ...org,
    leaderMemberIds: Array.isArray(org.leaderMemberIds) ? org.leaderMemberIds : [],
    members: members.map((m) => normalizeMemberForGql(m as Record<string, unknown>)),
  };
}

function mmStatusToGql(status: string): "DRAFT" | "SUBMITTED" | "REVIEWED" | "LOCKED" {
  if (status === "draft") return "DRAFT";
  if (status === "reviewed") return "REVIEWED";
  if (status === "locked") return "LOCKED";
  return "SUBMITTED";
}

function mmKindToGql(kind: string): "ORGANIZATION" | "TEAM" | "PROJECT" | "OTHER" {
  if (kind === "organization") return "ORGANIZATION";
  if (kind === "team") return "TEAM";
  if (kind === "project") return "PROJECT";
  return "OTHER";
}

function mmReasonTypeToGql(type: string): "HOLIDAY" | "LEAVE" | "EMPTY" | "UNCLASSIFIED" {
  if (type === "holiday") return "HOLIDAY";
  if (type === "leave") return "LEAVE";
  if (type === "empty") return "EMPTY";
  return "UNCLASSIFIED";
}

function normalizeMmEntryForGql(entry: Record<string, unknown>) {
  const buckets = Array.isArray(entry.buckets) ? entry.buckets : [];
  return {
    ...entry,
    status: mmStatusToGql(String(entry.status ?? "submitted")),
    buckets: buckets.map((bucket) => {
      const b = bucket as Record<string, unknown>;
      const reasons = Array.isArray(b.reasons) ? b.reasons : [];
      return {
        ...b,
        kind: mmKindToGql(String(b.kind ?? "other")),
        reasons: reasons.map((reason) => {
          const r = reason as Record<string, unknown>;
          return { ...r, type: mmReasonTypeToGql(String(r.type ?? "unclassified")) };
        }),
      };
    }),
  };
}

// resolver 의 공통 컨텍스트 — 기존 `const base = { doc, tables, caller }` 추론 타입과 동일.
type ResolverBase = {
  doc: typeof doc;
  tables: typeof tables;
  caller: Awaited<ReturnType<typeof getCallerMember>>;
};

// fieldName → resolver 매핑 테이블. 각 엔트리는 기존 switch case body 를 그대로 옮긴 것.
const RESOLVERS: Record<
  string,
  (event: AppsyncEvent, base: ResolverBase) => unknown | Promise<unknown>
> = {
  me: (_event, base) => normalizeMemberForGql(base.caller as unknown as Record<string, unknown>),
  createMember: async (event, base) =>
    normalizeMemberForGql((await createMember({
      ...base,
      input: event.arguments.input as import("./handlers/member").CreateMemberInput,
    })) as Record<string, unknown>),
  listMembers: async (event, base) =>
    (await listMembers({
      ...base,
      filter: event.arguments.filter as
        | { status?: "ACTIVE" | "REMOVED"; teamId?: string; workspaceRole?: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER" }
        | undefined,
    })).map((m) => normalizeMemberForGql(m as unknown as Record<string, unknown>)),
  getMember: async (event, base) => {
    const member = await getMember({ ...base, memberId: event.arguments.memberId as string });
    return member ? normalizeMemberForGql(member as unknown as Record<string, unknown>) : null;
  },
  updateMember: async (event, base) =>
    normalizeMemberForGql((await updateMember({ ...base, input: event.arguments.input as UpdateMemberInput & { memberId: string } })) as Record<string, unknown>),
  updateMyClientPrefs: async (event, base) => {
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
  },
  promoteToManager: async (event, base) =>
    normalizeMemberForGql((await promoteToManager({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>),
  demoteToMember: async (event, base) =>
    normalizeMemberForGql((await demoteToMember({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>),
  setMemberRole: async (event, base) =>
    normalizeMemberForGql((await setMemberRole({
      ...base,
      memberId: event.arguments.memberId as string,
      role: (event.arguments.role as string).toLowerCase() as import("./handlers/_auth").WorkspaceRole,
    })) as Record<string, unknown>),
  transferOwnership: async (event, base) =>
    normalizeMemberForGql((await transferOwnership({ ...base, toMemberId: event.arguments.toMemberId as string })) as Record<string, unknown>),
  removeMember: async (event, base) =>
    normalizeMemberForGql((await removeMember({ ...base, memberId: event.arguments.memberId as string })) as Record<string, unknown>),
  restoreMember: async (event, base) =>
    normalizeMemberForGql((await restoreMember({
      ...base,
      memberId: event.arguments.memberId as string,
    })) as Record<string, unknown>),
  assignMemberToTeam: async (event, base) => {
    await assignMemberToTeam({ ...base, memberId: event.arguments.memberId as string, teamId: event.arguments.teamId as string });
    return true;
  },
  unassignMemberFromTeam: async (event, base) => {
    await unassignMemberFromTeam({ ...base, memberId: event.arguments.memberId as string, teamId: event.arguments.teamId as string });
    return true;
  },
  listTeams: async (_event, base) =>
    (await listTeams(base)).map((t) => normalizeTeamForGql(t as unknown as Record<string, unknown>)),
  getTeam: async (event, base) => {
    const team = await getTeam({ ...base, teamId: event.arguments.teamId as string });
    return team ? normalizeTeamForGql(team as unknown as Record<string, unknown>) : null;
  },
  createTeam: async (event, base) =>
    normalizeTeamForGql((await createTeam({ ...base, name: event.arguments.name as string })) as Record<string, unknown>),
  updateTeam: async (event, base) =>
    normalizeTeamForGql((await updateTeam({
      ...base,
      teamId: event.arguments.teamId as string,
      name: event.arguments.name as string | undefined,
      leaderMemberIds: event.arguments.leaderMemberIds as string[] | undefined,
    })) as Record<string, unknown>),
  deleteTeam: async (event, base) => await deleteTeam({ ...base, teamId: event.arguments.teamId as string }),
  archiveTeam: async (event, base) =>
    normalizeTeamForGql(await archiveTeam({ ...base, teamId: event.arguments.teamId as string }) as Record<string, unknown>),
  restoreTeam: async (event, base) =>
    normalizeTeamForGql(await restoreTeam({ ...base, teamId: event.arguments.teamId as string }) as Record<string, unknown>),
  // ── 조직(실) ──────────────────────────────────────────────────────────
  listOrganizations: async (_event, base) =>
    (await listOrganizations(base)).map((o) => normalizeOrgForGql(o as unknown as Record<string, unknown>)),
  createOrganization: async (event, base) =>
    normalizeOrgForGql((await createOrganization({ ...base, name: event.arguments.name as string })) as unknown as Record<string, unknown>),
  updateOrganization: async (event, base) =>
    normalizeOrgForGql((await updateOrganization({
      ...base,
      organizationId: event.arguments.organizationId as string,
      name: event.arguments.name as string | undefined,
      leaderMemberIds: event.arguments.leaderMemberIds as string[] | undefined,
    })) as unknown as Record<string, unknown>),
  deleteOrganization: async (event, base) => await deleteOrganization({ ...base, organizationId: event.arguments.organizationId as string }),
  archiveOrganization: async (event, base) =>
    normalizeOrgForGql(await archiveOrganization({ ...base, organizationId: event.arguments.organizationId as string }) as unknown as Record<string, unknown>),
  restoreOrganization: async (event, base) =>
    normalizeOrgForGql(await restoreOrganization({ ...base, organizationId: event.arguments.organizationId as string }) as unknown as Record<string, unknown>),
  assignMemberToOrganization: async (event, base) => {
    await assignMemberToOrganization({ ...base, memberId: event.arguments.memberId as string, organizationId: event.arguments.organizationId as string });
    return true;
  },
  unassignMemberFromOrganization: async (event, base) => {
    await unassignMemberFromOrganization({ ...base, memberId: event.arguments.memberId as string, organizationId: event.arguments.organizationId as string });
    return true;
  },
  getWorkspaceMeta: async (event, base) => {
    const meta = await getWorkspaceMeta({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    });
    return {
      members: meta.members.map((member) => normalizeMemberForGql(member as unknown as Record<string, unknown>)),
      teams: meta.teams.map((team) => normalizeTeamForGql(team as unknown as Record<string, unknown>)),
      organizations: meta.organizations.map((organization) => normalizeOrgForGql(organization as unknown as Record<string, unknown>)),
      projects: meta.projects,
    };
  },
  createWorkspace: async (event, base) =>
    normalizeWorkspaceForGql((await createWorkspace({
      ...base,
      input: event.arguments.input as { name: string; access: Array<{ subjectType: "MEMBER" | "TEAM" | "EVERYONE"; subjectId?: string; level: "EDIT" | "VIEW" }> },
    })) as Record<string, unknown>),
  updateWorkspace: async (event, base) =>
    normalizeWorkspaceForGql((await updateWorkspace({
      ...base,
      input: event.arguments.input as { workspaceId: string; name?: string | null },
    })) as Record<string, unknown>),
  setWorkspaceAccess: async (event, base) =>
    normalizeWorkspaceForGql((await setWorkspaceAccess({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      entries: event.arguments.entries as Array<{ subjectType: "MEMBER" | "TEAM" | "EVERYONE"; subjectId?: string; level: "EDIT" | "VIEW" }>,
    })) as Record<string, unknown>),
  deleteWorkspace: async (event, base) => await deleteWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string }),
  archiveWorkspace: async (event, base) =>
    normalizeWorkspaceForGql(await archiveWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string }) as Record<string, unknown>),
  restoreWorkspace: async (event, base) =>
    normalizeWorkspaceForGql(await restoreWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string }) as Record<string, unknown>),
  listMyWorkspaces: async (_event, base) =>
    (await listMyWorkspaces(base)).map((w) => normalizeWorkspaceForGql(w as unknown as Record<string, unknown>)),
  getWorkspace: async (event, base) => {
    const ws = await getWorkspace({ ...base, workspaceId: event.arguments.workspaceId as string });
    return ws ? normalizeWorkspaceForGql(ws as unknown as Record<string, unknown>) : null;
  },
  searchMembersForMention: async (event, base) =>
    await searchMembersForMention({
      ...base,
      query: (event.arguments.query as string | null | undefined) ?? null,
      limit: (event.arguments.limit as number | null | undefined) ?? null,
    }),
  listPages: async (event, base) =>
    await listPages({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      updatedAfter: event.arguments.updatedAfter as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  listPageMetas: async (event, base) =>
    await listPageMetas({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      updatedAfter: event.arguments.updatedAfter as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  getPage: async (event, base) =>
    await getPage({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  getPageById: async (event, base) =>
    await getPageById({
      ...base,
      id: event.arguments.id as string,
    }),
  listDatabaseRows: async (event, base) =>
    await listDatabaseRows({
      ...base,
      databaseId: event.arguments.databaseId as string,
      workspaceId: event.arguments.workspaceId as string,
      organizationId: event.arguments.organizationId as string | undefined,
      teamId: event.arguments.teamId as string | undefined,
      projectId: event.arguments.projectId as string | undefined,
      assigneeId: event.arguments.assigneeId as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  listPageHistory: async (event, base) =>
    await listPageHistory({
      ...base,
      pageId: event.arguments.pageId as string,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
    }),
  listDatabaseHistory: async (event, base) =>
    await listDatabaseHistory({
      ...base,
      databaseId: event.arguments.databaseId as string,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
    }),
  listDatabaseRowHistory: async (event, base) =>
    await listDatabaseRowHistory({
      ...base,
      databaseId: event.arguments.databaseId as string,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  listDatabases: async (event, base) =>
    await listDatabases({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      updatedAfter: event.arguments.updatedAfter as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  getDatabase: async (event, base) =>
    await getDatabase({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  getFlowchart: async (event, base) =>
    await getFlowchart({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  listFlowcharts: async (event, base) =>
    await listFlowcharts({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      updatedAfter: event.arguments.updatedAfter as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  listFlowchartHistory: async (event, base) =>
    await listFlowchartHistory({
      ...base,
      flowchartId: event.arguments.flowchartId as string,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
    }),
  listTrashedPages: async (event, base) =>
    await listTrashedPages({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | null | undefined,
    }),
  listTrashedDatabases: async (event, base) =>
    await listTrashedDatabases({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | null | undefined,
    }),
  restoreDatabase: async (event, base) =>
    await restoreDatabase({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  upsertPage: async (event, base) =>
    await upsertPage({ ...base, input: event.arguments.input as Record<string, unknown> }),
  softDeletePage: async (event, base) =>
    await softDeletePage({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
      updatedAt: event.arguments.updatedAt as string,
    }),
  restorePage: async (event, base) =>
    await restorePage({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  restorePageVersion: async (event, base) =>
    await restorePageVersion({
      ...base,
      input: event.arguments.input as { pageId: string; workspaceId: string; historyId: string },
    }),
  savePageVersion: async (event, base) =>
    await savePageVersion({
      ...base,
      input: {
        pageId: event.arguments.pageId as string,
        workspaceId: event.arguments.workspaceId as string,
      },
    }),
  deletePageHistoryEvents: async (event, base) =>
    await deletePageHistoryEvents({
      ...base,
      pageId: event.arguments.pageId as string,
      workspaceId: event.arguments.workspaceId as string,
      historyIds: event.arguments.historyIds as string[],
    }),
  restoreDatabaseVersion: async (event, base) =>
    await restoreDatabaseVersion({
      ...base,
      input: event.arguments.input as { databaseId: string; workspaceId: string; historyId: string },
    }),
  saveDatabaseVersion: async (event, base) =>
    await saveDatabaseVersion({
      ...base,
      input: {
        databaseId: event.arguments.databaseId as string,
        workspaceId: event.arguments.workspaceId as string,
      },
    }),
  deleteDatabaseHistoryEvents: async (event, base) =>
    await deleteDatabaseHistoryEvents({
      ...base,
      databaseId: event.arguments.databaseId as string,
      workspaceId: event.arguments.workspaceId as string,
      historyIds: event.arguments.historyIds as string[],
    }),
  emptyTrash: async (event, base) =>
    await emptyTrash({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  permanentlyDeletePage: async (event, base) =>
    await permanentlyDeletePage({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  upsertDatabase: async (event, base) =>
    await upsertDatabase({ ...base, input: event.arguments.input as Record<string, unknown> }),
  upsertFlowchart: async (event, base) =>
    await upsertFlowchart({ ...base, input: event.arguments.input as Record<string, unknown> }),
  saveFlowchartVersion: async (event, base) =>
    await saveFlowchartVersion({
      ...base,
      flowchartId: event.arguments.flowchartId as string,
      workspaceId: event.arguments.workspaceId as string,
      title: event.arguments.title as string,
      data: event.arguments.data,
    }),
  softDeleteFlowchart: async (event, base) =>
    await softDeleteFlowchart({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
      updatedAt: event.arguments.updatedAt as string,
    }),
  softDeleteDatabase: async (event, base) =>
    await softDeleteDatabase({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
      updatedAt: event.arguments.updatedAt as string,
    }),
  permanentlyDeleteDatabase: async (event, base) =>
    await permanentlyDeleteDatabase({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  listComments: async (event, base) =>
    await listComments({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      updatedAfter: event.arguments.updatedAfter as string | undefined,
      limit: event.arguments.limit as number | undefined,
      nextToken: event.arguments.nextToken as string | undefined,
    }),
  upsertComment: async (event, base) =>
    await upsertComment({ ...base, input: event.arguments.input as Record<string, unknown> }),
  softDeleteComment: async (event, base) =>
    await softDeleteComment({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
      updatedAt: event.arguments.updatedAt as string,
    }),
  listMyNotifications: async (_event, base) =>
    await listMyNotifications({ doc: base.doc, tables: base.tables, caller: base.caller }),
  markNotificationRead: async (event, base) =>
    await markNotificationRead({ doc: base.doc, tables: base.tables, caller: base.caller, notificationId: event.arguments.notificationId as string }),
  deleteMyNotification: async (event, base) =>
    await deleteMyNotification({ doc: base.doc, tables: base.tables, caller: base.caller, notificationId: event.arguments.notificationId as string }),
  onCommentChanged: async (event, base) =>
    await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string }),
  onPageChanged: async (event, base) =>
    await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string }),
  onDatabaseChanged: async (event, base) =>
    await validateWorkspaceSubscription({ ...base, workspaceId: event.arguments.workspaceId as string }),
  listSchedules: async (event, base) =>
    await listSchedules({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      from: event.arguments.from as string,
      to: event.arguments.to as string,
      organizationId: event.arguments.organizationId as string | undefined,
      teamId: event.arguments.teamId as string | undefined,
      projectId: event.arguments.projectId as string | undefined,
      assigneeId: event.arguments.assigneeId as string | undefined,
    }),
  createSchedule: async (event, base) =>
    await createSchedule({
      ...base,
      input: event.arguments.input as {
        workspaceId: string;
        title: string;
        startAt: string;
        endAt: string;
        assigneeId?: string;
        color?: string;
      },
    }),
  updateSchedule: async (event, base) =>
    await updateSchedule({
      ...base,
      input: event.arguments.input as {
        id: string;
        workspaceId: string;
        title?: string;
        startAt?: string;
        endAt?: string;
        assigneeId?: string;
        color?: string;
      },
    }),
  deleteSchedule: async (event, base) =>
    await deleteSchedule({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  onScheduleChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  listProjects: async (event, base) =>
    await listProjects({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  createProject: async (event, base) =>
    await createProject({
      ...base,
      input: event.arguments.input as {
        workspaceId: string;
        name: string;
        color: string;
        description?: string;
        memberIds?: string[];
        leaderMemberIds?: string[];
        isHidden?: boolean;
      },
    }),
  updateProject: async (event, base) =>
    await updateProject({
      ...base,
      input: event.arguments.input as {
        id: string;
        workspaceId: string;
        name?: string;
        color?: string;
        description?: string;
        memberIds?: string[];
        leaderMemberIds?: string[];
        isHidden?: boolean;
      },
    }),
  deleteProject: async (event, base) =>
    await deleteProject({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  onProjectChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  listHolidays: async (event, base) =>
    await listHolidays({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  createHoliday: async (event, base) =>
    await createHoliday({
      ...base,
      input: event.arguments.input as {
        workspaceId: string;
        title: string;
        date: string;
        type: string;
        color: string;
      },
    }),
  updateHoliday: async (event, base) =>
    await updateHoliday({
      ...base,
      input: event.arguments.input as {
        id: string;
        workspaceId: string;
        title?: string;
        date?: string;
        type?: string;
        color?: string;
      },
    }),
  deleteHoliday: async (event, base) =>
    await deleteHoliday({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  onHolidayChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  listMmEntries: async (event, base) =>
    (await listMmEntries({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      fromWeekStart: event.arguments.fromWeekStart as string,
      toWeekStart: event.arguments.toWeekStart as string,
      memberId: event.arguments.memberId as string | undefined,
    })).map((entry) => normalizeMmEntryForGql(entry as unknown as Record<string, unknown>)),
  listMmRevisions: async (event, base) =>
    await listMmRevisions({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      entryId: event.arguments.entryId as string,
    }),
  upsertMmEntry: async (event, base) =>
    normalizeMmEntryForGql((await upsertMmEntry({
      ...base,
      input: event.arguments.input as Parameters<typeof upsertMmEntry>[0]["input"],
    })) as unknown as Record<string, unknown>),
  reviewMmEntry: async (event, base) =>
    normalizeMmEntryForGql((await reviewMmEntry({
      ...base,
      input: event.arguments.input as Parameters<typeof reviewMmEntry>[0]["input"],
    })) as unknown as Record<string, unknown>),
  lockMmEntry: async (event, base) =>
    normalizeMmEntryForGql((await setMmEntryLock({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      entryId: event.arguments.entryId as string,
      locked: true,
      note: event.arguments.note as string | undefined,
    })) as unknown as Record<string, unknown>),
  unlockMmEntry: async (event, base) =>
    normalizeMmEntryForGql((await setMmEntryLock({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      entryId: event.arguments.entryId as string,
      locked: false,
      note: event.arguments.note as string | undefined,
    })) as unknown as Record<string, unknown>),
  onMmEntryChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  // ── 자산 관리 ────────────────────────────────────────────────────
  listMyAssets: async (event, base) => {
    const res = await listMyAssets({
      ...base,
      input: (event.arguments.input as ListMyAssetsInput | null | undefined) ?? null,
    });
    return res;
  },
  getAssetUsages: async (event, base) =>
    await getAssetUsages({
      ...base,
      assetId: event.arguments.assetId as string,
    }),
  deleteMyAssets: async (event, base) =>
    await deleteMyAssets({
      ...base,
      assetIds: event.arguments.assetIds as string[],
    }),
  renameAsset: async (event, base) =>
    await renameAsset({
      ...base,
      assetId: event.arguments.assetId as string,
      name: (event.arguments.name as string | null | undefined) ?? null,
    }),
  replaceAssetRef: async (event, base) =>
    await replaceAssetRef({
      ...base,
      input: event.arguments.input as { oldAssetId: string; newAssetId: string },
    }),
  migrateAssetUsage: async (event, base) =>
    await migrateAssetUsage({
      ...base,
      cursor: (event.arguments.cursor as string | null | undefined) ?? null,
      incremental: (event.arguments.incremental as boolean | null | undefined) ?? false,
    }),
  // ── 워크스페이스 공유 커스텀 아이콘 ─────────────────────────────────
  listCustomIcons: async (event, base) =>
    await listCustomIcons({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  createCustomIcon: async (event, base) =>
    await createCustomIcon({
      ...base,
      input: event.arguments.input as { workspaceId: string; src: string; label: string },
    }),
  deleteCustomIcon: async (event, base) =>
    await deleteCustomIcon({
      ...base,
      id: event.arguments.id as string,
      workspaceId: event.arguments.workspaceId as string,
    }),
  // ── 페이지 웹 게시(publish to web) ─────────────────────────────────
  publishPage: async (event, base) =>
    await publishPage({
      ...base,
      pageId: event.arguments.pageId as string,
    }),
  unpublishPage: async (event, base) =>
    await unpublishPage({
      ...base,
      pageId: event.arguments.pageId as string,
    }),
  getPagePublishStatus: async (event, base) =>
    await getPagePublishStatus({
      ...base,
      pageId: event.arguments.pageId as string,
    }),
  onCustomIconChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  onWorkspaceChanged: async (event, base) =>
    await validateWorkspaceSubscription({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
    }),
  // ---------- AI 설정 ----------
  getWorkspaceAiConfig: async (event, base) =>
    await getWorkspaceAiConfig({ ...base, workspaceId: event.arguments.workspaceId as string }),
  setWorkspaceAiKey: async (event, base) =>
    await setWorkspaceAiKey({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      provider: event.arguments.provider as string,
      apiKey: event.arguments.apiKey as string,
    }),
  clearWorkspaceAiKey: async (event, base) =>
    await clearWorkspaceAiKey({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      provider: event.arguments.provider as string,
    }),
  updateWorkspaceAiSettings: async (event, base) =>
    await updateWorkspaceAiSettings({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      enabled: event.arguments.enabled as boolean | null | undefined,
      defaultModel: event.arguments.defaultModel as string | null | undefined,
      monthlyTokenLimit: event.arguments.monthlyTokenLimit as number | null | undefined,
    }),
  getWorkspaceAiUsage: async (event, base) =>
    await getWorkspaceAiUsage({
      ...base,
      workspaceId: event.arguments.workspaceId as string,
      month: event.arguments.month as string | null | undefined,
    }),
};

export async function handler(event: AppsyncEvent): Promise<unknown> {
  try {
    if (event.info.fieldName === "publishPageChanged") {
      return event.arguments.input as Record<string, unknown>;
    }

    const caller = await getCallerMember(doc, tables.Members, event.identity?.sub);
    const base = { doc, tables, caller };

    const resolver = RESOLVERS[event.info.fieldName];
    if (!resolver) {
      throw new ResolverError(`unknown fieldName: ${event.info.fieldName}`, "InternalError");
    }
    return await resolver(event, base);
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
