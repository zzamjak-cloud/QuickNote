import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import {
  requireRoleAtLeast,
  badRequest,
  type Member,
  type WorkspaceRole,
} from "./_auth";

export type Tables = {
  Members: string;
  Teams: string;
  MemberTeams: string;
  Workspaces: string;
  WorkspaceAccess: string;
};

export type CreateMemberInput = {
  email: string;
  name: string;
  jobRole: string;
  workspaceRole?: "OWNER" | "MANAGER" | "MEMBER";
  teamIds?: string[] | null;
};

type MemberFilterInput = {
  status?: "ACTIVE" | "REMOVED";
  teamId?: string;
  workspaceRole?: "OWNER" | "MANAGER" | "MEMBER";
};

type TxItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

// Pure helper: TransactWriteItems 항목 생성. 테스트하기 쉽게 분리.
export function buildCreateMemberTxItems(args: {
  input: CreateMemberInput;
  tables: Tables;
  memberId: string;
  personalWorkspaceId: string;
  now: string;
}): TxItem[] {
  const role = (args.input.workspaceRole ?? "MEMBER").toLowerCase() as WorkspaceRole;
  const items: TxItem[] = [];
  items.push({
    Put: {
      TableName: args.tables.Members,
      Item: {
        memberId: args.memberId,
        email: args.input.email.trim().toLowerCase(),
        name: args.input.name,
        jobRole: args.input.jobRole,
        workspaceRole: role,
        status: "active",
        personalWorkspaceId: args.personalWorkspaceId,
        cognitoSub: null,
        createdAt: args.now,
      },
      ConditionExpression: "attribute_not_exists(memberId)",
    },
  });
  items.push({
    Put: {
      TableName: args.tables.Workspaces,
      Item: {
        workspaceId: args.personalWorkspaceId,
        name: `${args.input.name}의 개인 워크스페이스`,
        type: "personal",
        ownerMemberId: args.memberId,
        createdAt: args.now,
      },
    },
  });
  items.push({
    Put: {
      TableName: args.tables.WorkspaceAccess,
      Item: {
        workspaceId: args.personalWorkspaceId,
        subjectKey: `member#${args.memberId}`,
        subjectType: "member",
        subjectId: args.memberId,
        level: "edit",
      },
    },
  });
  for (const teamId of args.input.teamIds ?? []) {
    items.push({
      Put: {
        TableName: args.tables.MemberTeams,
        Item: { memberId: args.memberId, teamId },
      },
    });
  }
  return items;
}

export async function createMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: CreateMemberInput;
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "manager");

  // OWNER 등록은 Owner 만 (transferOwnership 이외에는 보통 막음)
  if (args.input.workspaceRole === "OWNER" && args.caller.workspaceRole !== "owner") {
    badRequest("Manager 는 Owner 등록 불가");
  }

  // 이메일 중복 사전 검사 (TransactWrite ConditionExpression 도 있지만 GSI 검사가 더 명확)
  const existing = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Members,
      IndexName: "byEmail",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": args.input.email.trim().toLowerCase() },
      Limit: 1,
    }),
  );
  if (existing.Items && existing.Items.length > 0) {
    badRequest("이미 등록된 이메일");
  }

  const memberId = uuid();
  const personalWorkspaceId = uuid();
  const now = new Date().toISOString();

  // TransactWrite 25 항목 한계: teamIds 가 22 개 이상이면 차단 (Member+Workspace+Access+22 = 25)
  if ((args.input.teamIds?.length ?? 0) > 22) {
    badRequest("팀 22개 초과 — 분할 등록 필요");
  }

  const txItems = buildCreateMemberTxItems({
    input: args.input,
    tables: args.tables,
    memberId,
    personalWorkspaceId,
    now,
  });
  await args.doc.send(new TransactWriteCommand({ TransactItems: txItems }));

  return {
    memberId,
    email: args.input.email.trim().toLowerCase(),
    name: args.input.name,
    jobRole: args.input.jobRole,
    workspaceRole: ((args.input.workspaceRole ?? "MEMBER").toLowerCase()) as WorkspaceRole,
    status: "active",
    personalWorkspaceId,
    cognitoSub: null,
    createdAt: now,
  };
}

export async function listMembers(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  filter?: MemberFilterInput;
}): Promise<Member[]> {
  requireRoleAtLeast(args.caller, "manager");

  // teamId 필터: MemberTeams.GSI byTeam 으로 memberIds 추출 후 GetItem
  if (args.filter?.teamId) {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.MemberTeams,
        IndexName: "byTeam",
        KeyConditionExpression: "teamId = :t",
        ExpressionAttributeValues: { ":t": args.filter.teamId },
      }),
    );
    const ids = (r.Items ?? []).map((i) => i["memberId"] as string);
    if (ids.length === 0) return [];
    // 단순화: 각 id 별 GetItem (작은 조직 가정). 큰 조직은 BatchGetItem 필요.
    const results = await Promise.all(
      ids.map((id) =>
        args.doc.send(
          new GetCommand({ TableName: args.tables.Members, Key: { memberId: id } }),
        ),
      ),
    );
    return (results.map((res) => res.Item as Member | undefined).filter(Boolean) as Member[]).filter(
      (m) => passesFilter(m, args.filter),
    );
  }

  // 전체 Scan (소규모 조직 가정. 향후 페이지네이션/검색은 OpenSearch).
  const r = await args.doc.send(
    new ScanCommand({ TableName: args.tables.Members }),
  );
  return (r.Items as Member[]).filter((m) => passesFilter(m, args.filter));
}

function passesFilter(m: Member, f?: MemberFilterInput): boolean {
  if (!f) return true;
  if (f.status && m.status !== f.status.toLowerCase()) return false;
  if (f.workspaceRole && m.workspaceRole !== f.workspaceRole.toLowerCase()) return false;
  return true;
}

export async function getMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<Member | null> {
  requireRoleAtLeast(args.caller, "manager");
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Members, Key: { memberId: args.memberId } }),
  );
  return (r.Item as Member | undefined) ?? null;
}
