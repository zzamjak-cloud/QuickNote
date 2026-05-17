// 조직(실) CRUD 핸들러 — Team 핸들러의 미러 구조.
// DynamoDB 테이블: quicknote-organizations (organizationId PK)
// 관계 테이블: quicknote-member-organizations (memberId PK, organizationId SK, byOrganization GSI)

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

export type Organization = {
  organizationId: string;
  name: string;
  leaderMemberIds: string[];
  createdAt: string;
  removedAt?: string;
  members: Member[];
};

/** organizationId 로 단건 조회 (멤버 없이) */
async function getOrgById(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  organizationId: string,
): Promise<{ organizationId: string; name: string; leaderMemberIds?: string[]; createdAt: string } | undefined> {
  const r = await doc.send(
    new GetCommand({ TableName: tables.Organizations!, Key: { organizationId } }),
  );
  return r.Item as { organizationId: string; name: string; leaderMemberIds?: string[]; createdAt: string } | undefined;
}

/** MemberOrganizations 관계 테이블에서 조직 소속 멤버 목록 조회 */
async function resolveOrgMembers(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  organizationId: string,
): Promise<Member[]> {
  const rel = await doc.send(
    new QueryCommand({
      TableName: tables.MemberOrganizations!,
      IndexName: "byOrganization",
      KeyConditionExpression: "organizationId = :o",
      ExpressionAttributeValues: { ":o": organizationId },
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

export async function listOrganizations(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
}): Promise<Organization[]> {
  const r = await args.doc.send(new ScanCommand({ TableName: args.tables.Organizations! }));
  const base = (r.Items ?? []) as Array<{ organizationId: string; name: string; leaderMemberIds?: string[]; createdAt: string }>;
  return Promise.all(
    base.map(async (o) => ({
      ...o,
      leaderMemberIds: o.leaderMemberIds ?? [],
      members: await resolveOrgMembers(args.doc, args.tables, o.organizationId),
    })),
  );
}

export async function createOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  name: string;
}): Promise<Organization> {
  requireRoleAtLeast(args.caller, "manager");
  const name = args.name.trim();
  if (!name) badRequest("조직 이름은 비어 있을 수 없음");
  // 동일 이름 중복 생성 방지 — trim + case-insensitive 비교.
  // 활성 조직이 있으면 그대로 반환, 보관(removedAt) 조직이 있으면 복원 후 반환.
  const normalized = name.toLowerCase();
  const scan = await args.doc.send(
    new ScanCommand({ TableName: args.tables.Organizations! }),
  );
  const items = (scan.Items ?? []) as Array<{
    organizationId: string;
    name: string;
    createdAt: string;
    removedAt?: string;
  }>;
  const matched = items.find((o) => o.name.trim().toLowerCase() === normalized);
  if (matched) {
    if (matched.removedAt) {
      const r = await args.doc.send(
        new UpdateCommand({
          TableName: args.tables.Organizations!,
          Key: { organizationId: matched.organizationId },
          UpdateExpression: "REMOVE removedAt",
          ReturnValues: "ALL_NEW",
        }),
      );
      const restored = r.Attributes as {
        organizationId: string;
        name: string;
        leaderMemberIds?: string[];
        createdAt: string;
      };
      return {
        ...restored,
        leaderMemberIds: restored.leaderMemberIds ?? [],
        members: await resolveOrgMembers(
          args.doc,
          args.tables,
          matched.organizationId,
        ),
      };
    }
    return {
      organizationId: matched.organizationId,
      name: matched.name,
      leaderMemberIds: [],
      createdAt: matched.createdAt,
      members: await resolveOrgMembers(
        args.doc,
        args.tables,
        matched.organizationId,
      ),
    };
  }
  const now = new Date().toISOString();
  const organizationId = uuid();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Organizations!,
      Item: { organizationId, name, leaderMemberIds: [], createdAt: now },
      ConditionExpression: "attribute_not_exists(organizationId)",
    }),
  );
  return { organizationId, name, leaderMemberIds: [], createdAt: now, members: [] };
}

export async function updateOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  organizationId: string;
  name?: string;
  leaderMemberIds?: string[];
}): Promise<Organization> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getOrgById(args.doc, args.tables, args.organizationId);
  if (!existing) notFound("Organization 없음");
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const vals: Record<string, unknown> = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) badRequest("조직 이름은 비어 있을 수 없음");
    sets.push("#n = :n");
    names["#n"] = "name";
    vals[":n"] = name;
  }
  if (args.leaderMemberIds !== undefined) {
    sets.push("leaderMemberIds = :l");
    vals[":l"] = args.leaderMemberIds;
  }
  if (!sets.length) badRequest("변경할 조직 정보가 없습니다");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Organizations!,
      Key: { organizationId: args.organizationId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: vals,
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as { organizationId: string; name: string; leaderMemberIds?: string[]; createdAt: string }),
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
    members: await resolveOrgMembers(args.doc, args.tables, args.organizationId),
  };
}

export async function deleteOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  organizationId: string;
}): Promise<boolean> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getOrgById(args.doc, args.tables, args.organizationId);
  if (!existing) return false;

  // 관계 행 일괄 삭제
  const memberLinks = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.MemberOrganizations!,
      IndexName: "byOrganization",
      KeyConditionExpression: "organizationId = :o",
      ExpressionAttributeValues: { ":o": args.organizationId },
    }),
  );
  const memberDeletes = (memberLinks.Items ?? []).map((i) => ({
    DeleteRequest: { Key: { memberId: i.memberId as string, organizationId: i.organizationId as string } },
  }));
  for (let i = 0; i < memberDeletes.length; i += 25) {
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: { [args.tables.MemberOrganizations!]: memberDeletes.slice(i, i + 25) },
      }),
    );
  }

  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Organizations!,
      Key: { organizationId: args.organizationId },
    }),
  );
  return true;
}

export async function assignMemberToOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
  organizationId: string;
}): Promise<void> {
  requireRoleAtLeast(args.caller, "manager");
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.MemberOrganizations!,
      Item: { memberId: args.memberId, organizationId: args.organizationId },
    }),
  );
}

export async function unassignMemberFromOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
  organizationId: string;
}): Promise<void> {
  requireRoleAtLeast(args.caller, "manager");
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.MemberOrganizations!,
      Key: { memberId: args.memberId, organizationId: args.organizationId },
    }),
  );
}

export async function archiveOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  organizationId: string;
}): Promise<Organization> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getOrgById(args.doc, args.tables, args.organizationId);
  if (!existing) notFound("Organization 없음");
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Organizations!,
      Key: { organizationId: args.organizationId },
      UpdateExpression: "SET removedAt = :t",
      ExpressionAttributeValues: { ":t": now },
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as {
      organizationId: string;
      name: string;
      leaderMemberIds?: string[];
      createdAt: string;
      removedAt: string;
    }),
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
    members: await resolveOrgMembers(args.doc, args.tables, args.organizationId),
  };
}

export async function restoreOrganization(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  organizationId: string;
}): Promise<Organization> {
  requireRoleAtLeast(args.caller, "manager");
  const existing = await getOrgById(args.doc, args.tables, args.organizationId);
  if (!existing) notFound("Organization 없음");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Organizations!,
      Key: { organizationId: args.organizationId },
      UpdateExpression: "REMOVE removedAt",
      ReturnValues: "ALL_NEW",
    }),
  );
  return {
    ...(r.Attributes as {
      organizationId: string;
      name: string;
      leaderMemberIds?: string[];
      createdAt: string;
    }),
    leaderMemberIds: ((r.Attributes as { leaderMemberIds?: string[] }).leaderMemberIds ?? []),
    members: await resolveOrgMembers(args.doc, args.tables, args.organizationId),
  };
}
