import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

type MemberRow = {
  memberId: string;
  personalWorkspaceId: string;
  cognitoSub?: string | null;
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLES = {
  members: process.env.MEMBERS_TABLE_NAME ?? "",
  workspaces: process.env.WORKSPACES_TABLE_NAME ?? "",
  workspaceAccess: process.env.WORKSPACE_ACCESS_TABLE_NAME ?? "",
  pages: process.env.PAGES_TABLE_NAME ?? "",
  databases: process.env.DATABASES_TABLE_NAME ?? "",
};

function requireEnv(name: keyof typeof TABLES): string {
  const value = TABLES[name];
  if (!value) throw new Error(`${name} env is required`);
  return value;
}

function migratedEmail(ownerId: string): string {
  const safe = ownerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "owner";
  return `${safe.toLowerCase()}@migrated.quicknote.local`;
}

async function getOrCreateMember(ownerId: string): Promise<MemberRow> {
  const membersTable = requireEnv("members");

  const existing = await ddb.send(
    new QueryCommand({
      TableName: membersTable,
      IndexName: "byCognitoSub",
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": ownerId },
      Limit: 1,
    }),
  );
  const found = existing.Items?.[0] as MemberRow | undefined;
  if (found) return found;

  const memberId = uuid();
  const personalWorkspaceId = uuid();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: membersTable,
      Item: {
        memberId,
        email: migratedEmail(ownerId),
        name: `Migrated ${ownerId.slice(0, 8)}`,
        jobRole: "Migrated User",
        workspaceRole: "owner",
        status: "active",
        personalWorkspaceId,
        cognitoSub: ownerId,
        createdAt: now,
      },
      ConditionExpression: "attribute_not_exists(memberId)",
    }),
  );

  await ddb.send(
    new PutCommand({
      TableName: requireEnv("workspaces"),
      Item: {
        workspaceId: personalWorkspaceId,
        name: "마이그레이션 개인 워크스페이스",
        type: "personal",
        ownerMemberId: memberId,
        createdAt: now,
      },
      ConditionExpression: "attribute_not_exists(workspaceId)",
    }),
  );
  await ddb.send(
    new PutCommand({
      TableName: requireEnv("workspaceAccess"),
      Item: {
        workspaceId: personalWorkspaceId,
        subjectKey: `member#${memberId}`,
        subjectType: "member",
        subjectId: memberId,
        level: "edit",
      },
      ConditionExpression: "attribute_not_exists(workspaceId) AND attribute_not_exists(subjectKey)",
    }),
  );

  return { memberId, personalWorkspaceId, cognitoSub: ownerId };
}

async function migrateRecords(params: {
  tableName: string;
  ownerMap: Map<string, MemberRow>;
}): Promise<number> {
  const rows = await ddb.send(new ScanCommand({ TableName: params.tableName }));
  let updated = 0;
  for (const row of rows.Items ?? []) {
    const id = row.id as string | undefined;
    const ownerId = row.ownerId as string | undefined;
    const workspaceId = row.workspaceId as string | undefined;
    const createdByMemberId = row.createdByMemberId as string | undefined;
    if (!id || !ownerId) continue;
    if (workspaceId && createdByMemberId) continue;
    const m = params.ownerMap.get(ownerId);
    if (!m) continue;

    await ddb.send(
      new UpdateCommand({
        TableName: params.tableName,
        Key: { id },
        UpdateExpression:
          "SET workspaceId = if_not_exists(workspaceId, :w), createdByMemberId = if_not_exists(createdByMemberId, :m)",
        ExpressionAttributeValues: {
          ":w": m.personalWorkspaceId,
          ":m": m.memberId,
        },
      }),
    );
    updated += 1;
  }
  return updated;
}

export async function handler() {
  const pagesTable = requireEnv("pages");
  const databasesTable = requireEnv("databases");

  const pages = await ddb.send(new ScanCommand({ TableName: pagesTable }));
  const dbs = await ddb.send(new ScanCommand({ TableName: databasesTable }));

  const ownerIds = new Set<string>();
  for (const row of pages.Items ?? []) {
    if (typeof row.ownerId === "string" && row.ownerId) ownerIds.add(row.ownerId);
  }
  for (const row of dbs.Items ?? []) {
    if (typeof row.ownerId === "string" && row.ownerId) ownerIds.add(row.ownerId);
  }

  const ownerMap = new Map<string, MemberRow>();
  for (const ownerId of ownerIds) {
    const member = await getOrCreateMember(ownerId);
    ownerMap.set(ownerId, member);
  }

  const migratedPages = await migrateRecords({
    tableName: pagesTable,
    ownerMap,
  });
  const migratedDatabases = await migrateRecords({
    tableName: databasesTable,
    ownerMap,
  });

  return {
    owners: ownerIds.size,
    migratedPages,
    migratedDatabases,
  };
}
