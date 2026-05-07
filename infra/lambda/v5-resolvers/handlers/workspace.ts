import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { badRequest, notFound, requireRoleAtLeast, type Member } from "./_auth";
import type { Tables } from "./member";

type AccessLevel = "edit" | "view";
type AccessSubjectType = "member" | "team" | "everyone";

type WorkspaceAccessInput = {
  subjectType: "MEMBER" | "TEAM" | "EVERYONE";
  subjectId?: string | null;
  level: "EDIT" | "VIEW";
};

type WorkspaceAccessEntry = {
  subjectType: AccessSubjectType;
  subjectId: string | null;
  level: AccessLevel;
};

type WorkspaceRow = {
  workspaceId: string;
  name: string;
  type: "personal" | "shared";
  ownerMemberId: string;
  createdAt: string;
  jobFunctions?: string[];
  jobTitles?: string[];
};

export type Workspace = WorkspaceRow & {
  access: WorkspaceAccessEntry[];
  myEffectiveLevel: AccessLevel;
  options?: {
    jobFunctions: string[];
    jobTitles: string[];
  };
};

function toLevel(level: "EDIT" | "VIEW"): AccessLevel {
  return level === "EDIT" ? "edit" : "view";
}

function toSubjectType(t: "MEMBER" | "TEAM" | "EVERYONE"): AccessSubjectType {
  if (t === "MEMBER") return "member";
  if (t === "TEAM") return "team";
  return "everyone";
}

function subjectKey(subjectType: AccessSubjectType, subjectId: string | null): string {
  if (subjectType === "everyone") return "everyone#*";
  return `${subjectType}#${subjectId ?? ""}`;
}

async function getWorkspaceRow(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  workspaceId: string,
): Promise<WorkspaceRow | undefined> {
  const r = await doc.send(
    new GetCommand({ TableName: tables.Workspaces, Key: { workspaceId } }),
  );
  return r.Item as WorkspaceRow | undefined;
}

async function getWorkspaceAccess(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  workspaceId: string,
): Promise<WorkspaceAccessEntry[]> {
  const r = await doc.send(
    new QueryCommand({
      TableName: tables.WorkspaceAccess,
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": workspaceId },
    }),
  );
  return (r.Items ?? []).map((i) => ({
    subjectType: i.subjectType as AccessSubjectType,
    subjectId: (i.subjectId as string | undefined) ?? null,
    level: i.level as AccessLevel,
  }));
}

async function getCallerTeamIds(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  callerId: string,
): Promise<string[]> {
  const r = await doc.send(
    new QueryCommand({
      TableName: tables.MemberTeams,
      KeyConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":m": callerId },
    }),
  );
  return (r.Items ?? []).map((i) => i.teamId as string);
}

export function computeEffectiveLevel(
  entries: WorkspaceAccessEntry[],
  caller: Member,
  callerTeamIds: Set<string>,
): AccessLevel | null {
  for (const e of entries) {
    const matched =
      (e.subjectType === "member" && e.subjectId === caller.memberId) ||
      (e.subjectType === "team" && e.subjectId && callerTeamIds.has(e.subjectId)) ||
      e.subjectType === "everyone";
    if (matched) return e.level;
  }
  return null;
}

async function hydrateWorkspace(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  row: WorkspaceRow,
  caller: Member,
  callerTeamIds: Set<string>,
): Promise<Workspace | null> {
  const access = await getWorkspaceAccess(doc, tables, row.workspaceId);
  // owner는 WorkspaceAccess 엔트리 없이도 암묵적으로 edit 권한
  const level = caller.workspaceRole === "owner"
    ? "edit"
    : computeEffectiveLevel(access, caller, callerTeamIds);
  if (!level) return null;
  return {
    ...row,
    access,
    myEffectiveLevel: level,
    options: {
      jobFunctions: row.jobFunctions ?? [],
      jobTitles: row.jobTitles ?? [],
    },
  };
}

export async function createWorkspace(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { name: string; access: WorkspaceAccessInput[] };
}): Promise<Workspace> {
  requireRoleAtLeast(args.caller, "manager");
  const name = args.input.name.trim();
  if (!name) badRequest("워크스페이스 이름은 비어 있을 수 없음");
  if ((args.input.access?.length ?? 0) > 24) {
    badRequest("access 엔트리 24개 초과 불가");
  }
  const workspaceId = uuid();
  const createdAt = new Date().toISOString();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Workspaces,
      Item: {
        workspaceId,
        name,
        type: "shared",
        ownerMemberId: args.caller.memberId,
        createdAt,
      },
      ConditionExpression: "attribute_not_exists(workspaceId)",
    }),
  );
  const normalizedAccess = args.input.access.map((e) => ({
    subjectType: toSubjectType(e.subjectType),
    subjectId: e.subjectType === "EVERYONE" ? null : (e.subjectId ?? null),
    level: toLevel(e.level),
  }));
  const putReqs = normalizedAccess.map((e) => ({
    PutRequest: {
      Item: {
        workspaceId,
        subjectKey: subjectKey(e.subjectType, e.subjectId),
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        level: e.level,
      },
    },
  }));
  if (putReqs.length > 0) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.WorkspaceAccess]: putReqs },
      }),
    );
  }
  return {
    workspaceId,
    name,
    type: "shared",
    ownerMemberId: args.caller.memberId,
    createdAt,
    access: normalizedAccess,
    myEffectiveLevel: "edit",
  };
}

export async function updateWorkspace(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { workspaceId: string; name?: string | null; options?: { jobFunctions?: string[] | null; jobTitles?: string[] | null } | null };
}): Promise<Workspace> {
  requireRoleAtLeast(args.caller, "manager");
  const row = await getWorkspaceRow(args.doc, args.tables, args.input.workspaceId);
  if (!row) notFound("Workspace 없음");

  const sets: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, unknown> = {};

  if (args.input.name != null && args.input.name.trim()) {
    sets.push("#n = :n");
    names["#n"] = "name";
    vals[":n"] = args.input.name.trim();
  }
  if (args.input.options?.jobFunctions != null) {
    sets.push("jobFunctions = :jf");
    vals[":jf"] = args.input.options.jobFunctions;
  }
  if (args.input.options?.jobTitles != null) {
    sets.push("jobTitles = :jt");
    vals[":jt"] = args.input.options.jobTitles;
  }

  if (sets.length === 0) badRequest("변경할 항목 없음");

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Workspaces,
      Key: { workspaceId: args.input.workspaceId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: vals,
      ReturnValues: "ALL_NEW",
    }),
  );
  const updated = r.Attributes as WorkspaceRow;
  const access = await getWorkspaceAccess(args.doc, args.tables, args.input.workspaceId);
  return {
    ...updated,
    access,
    myEffectiveLevel: "edit",
    options: {
      jobFunctions: updated.jobFunctions ?? [],
      jobTitles: updated.jobTitles ?? [],
    },
  };
}

export async function setWorkspaceAccess(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  entries: WorkspaceAccessInput[];
}): Promise<Workspace> {
  requireRoleAtLeast(args.caller, "manager");
  const row = await getWorkspaceRow(args.doc, args.tables, args.workspaceId);
  if (!row) notFound("Workspace 없음");

  const existing = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.WorkspaceAccess,
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );
  const deleteReqs = (existing.Items ?? []).map((i) => ({
    DeleteRequest: { Key: { workspaceId: i.workspaceId, subjectKey: i.subjectKey } },
  }));
  for (let i = 0; i < deleteReqs.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.WorkspaceAccess]: deleteReqs.slice(i, i + 25) },
      }),
    );
  }

  const normalized = args.entries.map((e) => ({
    subjectType: toSubjectType(e.subjectType),
    subjectId: e.subjectType === "EVERYONE" ? null : (e.subjectId ?? null),
    level: toLevel(e.level),
  }));
  const putReqs = normalized.map((e) => ({
    PutRequest: {
      Item: {
        workspaceId: args.workspaceId,
        subjectKey: subjectKey(e.subjectType, e.subjectId),
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        level: e.level,
      },
    },
  }));
  for (let i = 0; i < putReqs.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.WorkspaceAccess]: putReqs.slice(i, i + 25) },
      }),
    );
  }
  return { ...row, access: normalized, myEffectiveLevel: "edit" };
}

export async function deleteWorkspace(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<boolean> {
  requireRoleAtLeast(args.caller, "manager");
  const row = await getWorkspaceRow(args.doc, args.tables, args.workspaceId);
  if (!row) return false;

  const access = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.WorkspaceAccess,
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );
  const accessDeletes = (access.Items ?? []).map((i) => ({
    DeleteRequest: { Key: { workspaceId: i.workspaceId, subjectKey: i.subjectKey } },
  }));
  for (let i = 0; i < accessDeletes.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.WorkspaceAccess]: accessDeletes.slice(i, i + 25) },
      }),
    );
  }

  if (args.tables.Pages) {
    const pages = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
      }),
    );
    const pageDeletes = (pages.Items ?? []).map((p) => ({
      DeleteRequest: { Key: { id: p.id } },
    }));
    for (let i = 0; i < pageDeletes.length; i += 25) {
      await args.doc.send(
        new BatchWriteCommand({
          RequestItems: { [args.tables.Pages]: pageDeletes.slice(i, i + 25) },
        }),
      );
    }
  }
  if (args.tables.Databases) {
    const dbs = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Databases,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
      }),
    );
    const dbDeletes = (dbs.Items ?? []).map((d) => ({
      DeleteRequest: { Key: { id: d.id } },
    }));
    for (let i = 0; i < dbDeletes.length; i += 25) {
      await args.doc.send(
        new BatchWriteCommand({
          RequestItems: { [args.tables.Databases]: dbDeletes.slice(i, i + 25) },
        }),
      );
    }
  }

  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Workspaces,
      Key: { workspaceId: args.workspaceId },
    }),
  );
  return true;
}

export async function listMyWorkspaces(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
}): Promise<Workspace[]> {
  const teamIds = await getCallerTeamIds(args.doc, args.tables, args.caller.memberId);
  const teamSet = new Set(teamIds);
  const subjectKeys = [
    `member#${args.caller.memberId}`,
    ...teamIds.map((id) => `team#${id}`),
    "everyone#*",
  ];
  const workspaceIds = new Set<string>([args.caller.personalWorkspaceId]);

  for (const sk of subjectKeys) {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.WorkspaceAccess,
        IndexName: "bySubject",
        KeyConditionExpression: "subjectKey = :sk",
        ExpressionAttributeValues: { ":sk": sk },
      }),
    );
    for (const item of r.Items ?? []) {
      workspaceIds.add(item.workspaceId as string);
    }
  }

  const workspaceIdList = Array.from(workspaceIds);
  const fetchedRows = await Promise.all(
    workspaceIdList.map((workspaceId) =>
      getWorkspaceRow(args.doc, args.tables, workspaceId),
    ),
  );

  // 개인 워크스페이스 DynamoDB 레코드가 없으면 자동 생성
  const rows = [...fetchedRows];
  const personalIdx = workspaceIdList.indexOf(args.caller.personalWorkspaceId);
  if (personalIdx >= 0 && !rows[personalIdx]) {
    const now = new Date().toISOString();
    const personalRow: WorkspaceRow = {
      workspaceId: args.caller.personalWorkspaceId,
      name: "개인 워크스페이스",
      type: "personal",
      ownerMemberId: args.caller.memberId,
      createdAt: now,
    };
    try {
      await args.doc.send(
        new PutCommand({
          TableName: args.tables.Workspaces,
          Item: personalRow,
          ConditionExpression: "attribute_not_exists(workspaceId)",
        }),
      );
    } catch {
      // 동시에 생성된 경우 무시
    }
    rows[personalIdx] = personalRow;
  }

  const hydrated = await Promise.all(
    rows
      .filter((r): r is WorkspaceRow => Boolean(r))
      .map((r) => hydrateWorkspace(args.doc, args.tables, r, args.caller, teamSet)),
  );
  return hydrated.filter((w): w is Workspace => Boolean(w));
}

export async function getWorkspace(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<Workspace | null> {
  const row = await getWorkspaceRow(args.doc, args.tables, args.workspaceId);
  if (!row) return null;
  const teamSet = new Set(
    await getCallerTeamIds(args.doc, args.tables, args.caller.memberId),
  );
  return hydrateWorkspace(args.doc, args.tables, row, args.caller, teamSet);
}

export async function listWorkspacesForDebug(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
}): Promise<WorkspaceRow[]> {
  const r = await args.doc.send(new ScanCommand({ TableName: args.tables.Workspaces }));
  return (r.Items ?? []) as WorkspaceRow[];
}
