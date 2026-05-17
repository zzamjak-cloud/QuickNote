// LC 스케줄러 프로젝트 핸들러 — workspace 권한 검사 후 DynamoDB CRUD 수행.
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

// 프로젝트 레코드 형상 (DynamoDB 저장 단위)
type ProjectRecord = {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  description?: string;
  memberIds: string[];
  leaderMemberIds: string[];
  isHidden: boolean;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

// ID 생성기
function genId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function listProjects(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<ProjectRecord[]> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });

  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Projects!,
      IndexName: "byWorkspace",
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );
  return ((r.Items ?? []) as ProjectRecord[]).map((project) => ({
    ...project,
    leaderMemberIds: project.leaderMemberIds ?? [],
  }));
}

export async function createProject(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    workspaceId: string;
    name: string;
    color: string;
    description?: string | null;
    memberIds?: string[] | null;
    leaderMemberIds?: string[] | null;
    isHidden?: boolean | null;
  };
}): Promise<ProjectRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  const now = new Date().toISOString();
  const item: ProjectRecord = {
    id: genId(),
    workspaceId: args.input.workspaceId,
    name: args.input.name,
    color: args.input.color,
    memberIds: args.input.memberIds ?? [],
    leaderMemberIds: args.input.leaderMemberIds ?? [],
    isHidden: args.input.isHidden ?? false,
    createdByMemberId: args.caller.memberId,
    createdAt: now,
    updatedAt: now,
    ...(args.input.description ? { description: args.input.description } : {}),
  };

  await args.doc.send(new PutCommand({ TableName: args.tables.Projects!, Item: item }));
  return item;
}

export async function updateProject(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    id: string;
    workspaceId: string;
    name?: string | null;
    color?: string | null;
    description?: string | null;
    memberIds?: string[] | null;
    leaderMemberIds?: string[] | null;
    isHidden?: boolean | null;
  };
}): Promise<ProjectRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  // DynamoDB 예약어 회피: name → #nm
  const names: Record<string, string> = {};
  const updates: string[] = ["updatedAt = :t"];
  const vals: Record<string, unknown> = { ":t": new Date().toISOString() };

  if (args.input.name != null) {
    names["#nm"] = "name";
    updates.push("#nm = :n");
    vals[":n"] = args.input.name;
  }
  if (args.input.color != null) { updates.push("color = :c"); vals[":c"] = args.input.color; }
  if (args.input.description != null) { updates.push("description = :d"); vals[":d"] = args.input.description; }
  if (args.input.memberIds != null) { updates.push("memberIds = :m"); vals[":m"] = args.input.memberIds; }
  if (args.input.leaderMemberIds != null) { updates.push("leaderMemberIds = :l"); vals[":l"] = args.input.leaderMemberIds; }
  if (args.input.isHidden != null) { updates.push("isHidden = :h"); vals[":h"] = args.input.isHidden; }

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Projects!,
      Key: { id: args.input.id, workspaceId: args.input.workspaceId },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeValues: vals,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ReturnValues: "ALL_NEW",
    }),
  );
  const next = r.Attributes as ProjectRecord;
  return { ...next, leaderMemberIds: next.leaderMemberIds ?? [] };
}

export async function deleteProject(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });

  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Projects!,
      Key: { id: args.id, workspaceId: args.workspaceId },
    }),
  );
  return true;
}
