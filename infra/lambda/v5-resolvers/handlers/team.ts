import {
  BatchGetCommand,
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

// memberId 목록을 BatchGetCommand 로 일괄 조회한다.
// - 100개씩 청크로 분할 (BatchGet 단일 요청 한계).
// - throttle 등으로 UnprocessedKeys 가 반환되면 최대 5회까지 재시도(지수 백오프).
// - 반환 순서는 보장하지 않으며(BatchGet 특성), 호출부에서 필터/정렬을 수행한다.
async function batchGetMembersByIds(
  doc: DynamoDBDocumentClient,
  membersTableName: string,
  ids: string[],
): Promise<Member[]> {
  if (ids.length === 0) return [];
  const collected: Member[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    // 미처리 키 재시도 루프 — 처리할 키가 없을 때까지 반복(최대 5회).
    let keys: Array<{ memberId: string }> = chunk.map((memberId) => ({ memberId }));
    for (let attempt = 0; attempt < 5 && keys.length > 0; attempt++) {
      if (attempt > 0) {
        // 간단한 지수 백오프 (50ms, 100ms, 200ms ...)
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
      const res = await doc.send(
        new BatchGetCommand({
          RequestItems: { [membersTableName]: { Keys: keys } },
        }),
      );
      const items = (res.Responses?.[membersTableName] ?? []) as Member[];
      collected.push(...items);
      const unprocessed = res.UnprocessedKeys?.[membersTableName]?.Keys as
        | Array<{ memberId: string }>
        | undefined;
      keys = unprocessed ?? [];
    }
  }
  return collected;
}

export type Team = {
  teamId: string;
  name: string;
  leaderMemberIds: string[];
  createdAt: string;
  removedAt?: string;
  members: Member[];
};

async function getTeamById(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  teamId: string,
): Promise<{ teamId: string; name: string; leaderMemberIds?: string[]; createdAt: string } | undefined> {
  const r = await doc.send(new GetCommand({ TableName: tables.Teams, Key: { teamId } }));
  return r.Item as { teamId: string; name: string; leaderMemberIds?: string[]; createdAt: string } | undefined;
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
  // N+1 GetItem 대신 BatchGetCommand 로 일괄 조회.
  const rows = await batchGetMembersByIds(doc, tables.Members, memberIds);
  return rows.filter((m): m is Member => Boolean(m && m.status === "active"));
}

export async function listTeams(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
}): Promise<Team[]> {
  const r = await args.doc.send(new ScanCommand({ TableName: args.tables.Teams }));
  const base = (r.Items ?? []) as Array<{ teamId: string; name: string; leaderMemberIds?: string[]; createdAt: string }>;
  return Promise.all(
    base.map(async (t) => ({ ...t, leaderMemberIds: t.leaderMemberIds ?? [], members: await resolveTeamMembers(args.doc, args.tables, t.teamId) })),
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
  return {
    ...team,
    leaderMemberIds: team.leaderMemberIds ?? [],
    members: await resolveTeamMembers(args.doc, args.tables, args.teamId),
  };
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
  // 전체 Scan 대신 byName GSI(파티션키 nameLower) Query 로 후보만 조회.
  const normalized = name.toLowerCase();
  const q = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Teams,
      IndexName: "byName",
      KeyConditionExpression: "nameLower = :n",
      ExpressionAttributeValues: { ":n": normalized },
    }),
  );
  const items = (q.Items ?? []) as Array<{
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
      const restored = r.Attributes as { teamId: string; name: string; leaderMemberIds?: string[]; createdAt: string };
      return {
        ...restored,
        leaderMemberIds: restored.leaderMemberIds ?? [],
        members: await resolveTeamMembers(args.doc, args.tables, matched.teamId),
      };
    }
    return {
      teamId: matched.teamId,
      name: matched.name,
      leaderMemberIds: [],
      createdAt: matched.createdAt,
      members: await resolveTeamMembers(args.doc, args.tables, matched.teamId),
    };
  }
  const now = new Date().toISOString();
  const teamId = uuid();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Teams,
      // nameLower 는 byName GSI 파티션키 — 중복체크 Query 가 동작하려면 반드시 저장.
      Item: { teamId, name, nameLower: normalized, leaderMemberIds: [], createdAt: now },
      ConditionExpression: "attribute_not_exists(teamId)",
    }),
  );
  return { teamId, name, leaderMemberIds: [], createdAt: now, members: [] };
}

export async function updateTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  teamId: string;
  name?: string | null;
  leaderMemberIds?: string[] | null;
}): Promise<Team> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getTeamById(args.doc, args.tables, args.teamId);
  if (!existing) notFound("Team 없음");
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, unknown> = {};
  if (typeof args.name === "string") {
    const name = args.name.trim();
    if (!name) badRequest("팀 이름은 비어 있을 수 없음");
    sets.push("#n = :n");
    names["#n"] = "name";
    vals[":n"] = name;
    // 이름 변경 시 byName GSI 색인 키도 함께 갱신.
    sets.push("nameLower = :nl");
    vals[":nl"] = name.toLowerCase();
  }
  if (Array.isArray(args.leaderMemberIds)) {
    sets.push("leaderMemberIds = :l");
    vals[":l"] = args.leaderMemberIds;
  }
  if (!sets.length) badRequest("변경할 팀 정보가 없습니다");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Teams,
      Key: { teamId: args.teamId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: vals,
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as { teamId: string; name: string; leaderMemberIds?: string[]; createdAt: string }),
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
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
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
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
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
    members: await resolveTeamMembers(args.doc, args.tables, args.teamId),
  };
}
