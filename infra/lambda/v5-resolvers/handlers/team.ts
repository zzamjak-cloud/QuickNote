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

export type Team = {
  teamId: string;
  name: string;
  createdAt: string;
  removedAt?: string;
  members: Member[];
};

async function getTeamById(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  teamId: string,
): Promise<{ teamId: string; name: string; createdAt: string } | undefined> {
  const r = await doc.send(new GetCommand({ TableName: tables.Teams, Key: { teamId } }));
  return r.Item as { teamId: string; name: string; createdAt: string } | undefined;
}

async function resolveTeamMembers(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  teamId: string,
): Promise<Member[]> {
  const rel = await doc.send(
    new QueryCommand({
      TableName: tables.MemberTeams,
      IndexName: "byTeam",
      KeyConditionExpression: "teamId = :t",
      ExpressionAttributeValues: { ":t": teamId },
    }),
  );
  const memberIds = (rel.Items ?? []).map((v) => v.memberId as string);
  if (memberIds.length === 0) return [];
  const rows = await Promise.all(
    memberIds.map((memberId) =>
      doc.send(new GetCommand({ TableName: tables.Members, Key: { memberId } })),
    ),
  );
  return rows
    .map((r) => r.Item as Member | undefined)
    .filter((m): m is Member => Boolean(m && m.status === "active"));
}

export async function listTeams(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
}): Promise<Team[]> {
  const r = await args.doc.send(new ScanCommand({ TableName: args.tables.Teams }));
  const base = (r.Items ?? []) as Array<{ teamId: string; name: string; createdAt: string }>;
  return Promise.all(
    base.map(async (t) => ({ ...t, members: await resolveTeamMembers(args.doc, args.tables, t.teamId) })),
  );
}

export async function getTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
}): Promise<Team | null> {
  requireRoleAtLeast(args.caller, "manager");
  const team = await getTeamById(args.doc, args.tables, args.teamId);
  if (!team) return null;
  return { ...team, members: await resolveTeamMembers(args.doc, args.tables, args.teamId) };
}

export async function createTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  name: string;
}): Promise<Team> {
  requireRoleAtLeast(args.caller, "manager");
  const name = args.name.trim();
  if (!name) badRequest("팀 이름은 비어 있을 수 없음");
  // 동일 이름 중복 생성 방지 — trim + case-insensitive 비교.
  // 활성 팀이 있으면 그대로 반환, 보관(removedAt) 팀이 있으면 복원 후 반환.
  const normalized = name.toLowerCase();
  const scan = await args.doc.send(new ScanCommand({ TableName: args.tables.Teams }));
  const items = (scan.Items ?? []) as Array<{
    teamId: string;
    name: string;
    createdAt: string;
    removedAt?: string;
  }>;
  const matched = items.find((t) => t.name.trim().toLowerCase() === normalized);
  if (matched) {
    if (matched.removedAt) {
      // 보관된 동명 팀 복원
      const r = await args.doc.send(
        new UpdateCommand({
          TableName: args.tables.Teams,
          Key: { teamId: matched.teamId },
          UpdateExpression: "REMOVE removedAt",
          ReturnValues: "ALL_NEW",
        }),
      );
      const restored = r.Attributes as { teamId: string; name: string; createdAt: string };
      return {
        ...restored,
        members: await resolveTeamMembers(args.doc, args.tables, matched.teamId),
      };
    }
    return {
      teamId: matched.teamId,
      name: matched.name,
      createdAt: matched.createdAt,
      members: await resolveTeamMembers(args.doc, args.tables, matched.teamId),
    };
  }
  const now = new Date().toISOString();
  const teamId = uuid();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Teams,
      Item: { teamId, name, createdAt: now },
      ConditionExpression: "attribute_not_exists(teamId)",
    }),
  );
  return { teamId, name, createdAt: now, members: [] };
}

export async function updateTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
  name: string;
}): Promise<Team> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getTeamById(args.doc, args.tables, args.teamId);
  if (!existing) notFound("Team 없음");
  const name = args.name.trim();
  if (!name) badRequest("팀 이름은 비어 있을 수 없음");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Teams,
      Key: { teamId: args.teamId },
      UpdateExpression: "SET #n = :n",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": name },
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as { teamId: string; name: string; createdAt: string }),
    members: await resolveTeamMembers(args.doc, args.tables, args.teamId),
  };
}

export async function deleteTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
}): Promise<boolean> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getTeamById(args.doc, args.tables, args.teamId);
  if (!existing) return false;

  const memberLinks = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.MemberTeams,
      IndexName: "byTeam",
      KeyConditionExpression: "teamId = :t",
      ExpressionAttributeValues: { ":t": args.teamId },
    }),
  );
  const accessLinks = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.WorkspaceAccess,
      IndexName: "bySubject",
      KeyConditionExpression: "subjectKey = :sk",
      ExpressionAttributeValues: { ":sk": `team#${args.teamId}` },
    }),
  );

  const memberDeletes = (memberLinks.Items ?? []).map((i) => ({
    DeleteRequest: { Key: { memberId: i.memberId, teamId: i.teamId } },
  }));
  const accessDeletes = (accessLinks.Items ?? []).map((i) => ({
    DeleteRequest: { Key: { workspaceId: i.workspaceId, subjectKey: i.subjectKey } },
  }));

  for (let i = 0; i < memberDeletes.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.MemberTeams]: memberDeletes.slice(i, i + 25) },
      }),
    );
  }
  for (let i = 0; i < accessDeletes.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.WorkspaceAccess]: accessDeletes.slice(i, i + 25) },
      }),
    );
  }

  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Teams,
      Key: { teamId: args.teamId },
    }),
  );
  return true;
}

export async function archiveTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
}): Promise<Team> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getTeamById(args.doc, args.tables, args.teamId);
  if (!existing) notFound("Team 없음");
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Teams,
      Key: { teamId: args.teamId },
      UpdateExpression: "SET removedAt = :t",
      ExpressionAttributeValues: { ":t": now },
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as { teamId: string; name: string; createdAt: string; removedAt: string }),
    members: await resolveTeamMembers(args.doc, args.tables, args.teamId),
  };
}

export async function restoreTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
}): Promise<Team> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getTeamById(args.doc, args.tables, args.teamId);
  if (!existing) notFound("Team 없음");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Teams,
      Key: { teamId: args.teamId },
      UpdateExpression: "REMOVE removedAt",
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as { teamId: string; name: string; createdAt: string }),
    members: await resolveTeamMembers(args.doc, args.tables, args.teamId),
  };
}
