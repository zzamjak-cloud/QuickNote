import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import {
  requireRoleAtLeast,
  requireOwnerOnly,
  preventOwnerMutation,
  badRequest,
  notFound,
  forbidden,
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

// 내부 helper: memberId 로 Member 직접 조회 (권한 검사 없음)
async function getMemberById(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  memberId: string,
): Promise<Member | undefined> {
  const r = await doc.send(
    new GetCommand({ TableName: tables.Members, Key: { memberId } }),
  );
  return r.Item as Member | undefined;
}

// ─── updateMember ─────────────────────────────────────────────────────────────

export type UpdateMemberInput = {
  name?: string | null;
  jobRole?: string | null;
  teamIds?: string[] | null;
};

export async function updateMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: UpdateMemberInput & { memberId: string };
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "manager");
  const target = await getMemberById(args.doc, args.tables, args.input.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");
  preventOwnerMutation(args.caller, target);

  // name/jobRole 업데이트
  const sets: string[] = [];
  const vals: Record<string, unknown> = {};
  if (args.input.name != null) { sets.push("name = :n"); vals[":n"] = args.input.name; }
  if (args.input.jobRole != null) { sets.push("jobRole = :j"); vals[":j"] = args.input.jobRole; }

  let updated: Member = target;
  if (sets.length > 0) {
    const r = await args.doc.send(
      new UpdateCommand({
        TableName: args.tables.Members,
        Key: { memberId: args.input.memberId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeValues: vals,
        ReturnValues: "ALL_NEW",
      }),
    );
    updated = r.Attributes as Member;
  }

  // teamIds 갱신: 기존 MemberTeams 제거 후 신규 삽입
  if (args.input.teamIds != null) {
    // 기존 팀 조회
    const existing = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.MemberTeams,
        KeyConditionExpression: "memberId = :m",
        ExpressionAttributeValues: { ":m": args.input.memberId },
      }),
    );
    const oldTeamIds = (existing.Items ?? []).map((i) => i["teamId"] as string);

    // 삭제 + 추가 batch
    const deletes = oldTeamIds.map((teamId) => ({
      DeleteRequest: { Key: { memberId: args.input.memberId, teamId } },
    }));
    const puts = args.input.teamIds.map((teamId) => ({
      PutRequest: { Item: { memberId: args.input.memberId, teamId } },
    }));
    const allOps = [...deletes, ...puts];
    // BatchWrite 25개 한계 분할
    for (let i = 0; i < allOps.length; i += 25) {
      await args.doc.send(
        new BatchWriteCommand({
          RequestItems: { [args.tables.MemberTeams]: allOps.slice(i, i + 25) },
        }),
      );
    }
  }

  return updated;
}

// ─── promoteToManager ─────────────────────────────────────────────────────────

export async function promoteToManager(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<Member> {
  requireOwnerOnly(args.caller);
  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");
  if (target.workspaceRole !== "member") badRequest("이미 manager 또는 owner");

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Members,
      Key: { memberId: args.memberId },
      UpdateExpression: "SET workspaceRole = :r",
      ConditionExpression: "workspaceRole = :prev",
      ExpressionAttributeValues: { ":r": "manager", ":prev": "member" },
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as Member;
}

// ─── demoteToMember ───────────────────────────────────────────────────────────

export async function demoteToMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<Member> {
  requireOwnerOnly(args.caller);
  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.workspaceRole === "owner") forbidden("Owner 는 강등 불가");
  if (target.workspaceRole !== "manager") badRequest("manager 가 아닌 멤버");

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Members,
      Key: { memberId: args.memberId },
      UpdateExpression: "SET workspaceRole = :r",
      ConditionExpression: "workspaceRole = :prev",
      ExpressionAttributeValues: { ":r": "member", ":prev": "manager" },
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as Member;
}

// ─── transferOwnership ────────────────────────────────────────────────────────

export async function transferOwnership(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  toMemberId: string;
}): Promise<Member> {
  requireOwnerOnly(args.caller);
  if (args.caller.memberId === args.toMemberId) badRequest("자기 자신에게 양도 불가");

  const target = await getMemberById(args.doc, args.tables, args.toMemberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");
  if (target.workspaceRole !== "manager") badRequest("Manager 만 Owner 로 승격 가능");

  // 두 row 동시 업데이트 — TransactWrite
  await args.doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: args.tables.Members,
            Key: { memberId: args.caller.memberId },
            UpdateExpression: "SET workspaceRole = :m",
            ConditionExpression: "workspaceRole = :owner",
            ExpressionAttributeValues: { ":m": "member", ":owner": "owner" },
          },
        },
        {
          Update: {
            TableName: args.tables.Members,
            Key: { memberId: args.toMemberId },
            UpdateExpression: "SET workspaceRole = :o",
            ConditionExpression: "workspaceRole = :mgr",
            ExpressionAttributeValues: { ":o": "owner", ":mgr": "manager" },
          },
        },
      ],
    }),
  );

  return { ...target, workspaceRole: "owner" };
}

// ─── removeMember ─────────────────────────────────────────────────────────────

type TxItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export type RemoveMemberPlan = {
  primaryItems: TxItem[];
  secondaryDeletes: Array<
    | { table: string; key: { memberId: string; teamId: string } }
    | { table: string; key: { workspaceId: string; subjectKey: string } }
  >;
};

// Pure helper: 트랜잭션 항목 생성. 단위 테스트 가능하도록 export.
export function buildRemoveMemberPlan(args: {
  caller: Member;
  target: Member;
  targetTeams: string[];
  targetAccessEntries: Array<{ workspaceId: string; subjectKey: string }>;
  tables: Tables;
  now: string;
}): RemoveMemberPlan {
  const { caller, target, tables, now } = args;
  const personalWsId = target.personalWorkspaceId;

  const primaryItems: TxItem[] = [
    // 1. Members status = removed
    {
      Update: {
        TableName: tables.Members,
        Key: { memberId: target.memberId },
        UpdateExpression: "SET #s = :removed, removedAt = :now",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":removed": "removed", ":now": now },
      },
    },
    // 2. 개인 워크스페이스 소유권 이전 + 이름 변경
    {
      Update: {
        TableName: tables.Workspaces,
        Key: { workspaceId: personalWsId },
        UpdateExpression: "SET ownerMemberId = :caller, #n = :name",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: {
          ":caller": caller.memberId,
          ":name": `${target.name}의 개인 노트 (제거됨)`,
        },
      },
    },
    // 3. 기존 WorkspaceAccess (target) 제거
    {
      Delete: {
        TableName: tables.WorkspaceAccess,
        Key: { workspaceId: personalWsId, subjectKey: `member#${target.memberId}` },
      },
    },
    // 4. 새 WorkspaceAccess (caller) 삽입
    {
      Put: {
        TableName: tables.WorkspaceAccess,
        Item: {
          workspaceId: personalWsId,
          subjectKey: `member#${caller.memberId}`,
          subjectType: "member",
          subjectId: caller.memberId,
          level: "edit",
        },
      },
    },
  ];

  // secondary: MemberTeams + WorkspaceAccess(bySubject) — batch 후처리
  const secondaryDeletes: RemoveMemberPlan["secondaryDeletes"] = [
    ...args.targetTeams.map((teamId) => ({
      table: tables.MemberTeams,
      key: { memberId: target.memberId, teamId },
    })),
    ...args.targetAccessEntries
      .filter((e) => !(e.workspaceId === personalWsId && e.subjectKey === `member#${target.memberId}`))
      .map((e) => ({
        table: tables.WorkspaceAccess,
        key: { workspaceId: e.workspaceId, subjectKey: e.subjectKey },
      })),
  ];

  return { primaryItems, secondaryDeletes };
}

export async function removeMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<{ memberId: string }> {
  requireOwnerOnly(args.caller);

  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.workspaceRole === "owner") forbidden("Owner 는 제거 불가");
  if (target.status !== "active") badRequest("이미 제거된 멤버");

  const now = new Date().toISOString();

  // MemberTeams 조회
  const teamsResult = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.MemberTeams,
      KeyConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":m": args.memberId },
    }),
  );
  const targetTeams = (teamsResult.Items ?? []).map((i) => i["teamId"] as string);

  // WorkspaceAccess GSI(bySubject) 조회 — subjectKey="member#"+target
  const accessResult = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.WorkspaceAccess,
      IndexName: "bySubject",
      KeyConditionExpression: "subjectKey = :sk",
      ExpressionAttributeValues: { ":sk": `member#${args.memberId}` },
    }),
  );
  const targetAccessEntries = (accessResult.Items ?? []).map((i) => ({
    workspaceId: i["workspaceId"] as string,
    subjectKey: i["subjectKey"] as string,
  }));

  const plan = buildRemoveMemberPlan({
    caller: args.caller,
    target,
    targetTeams,
    targetAccessEntries,
    tables: args.tables,
    now,
  });

  // primary transaction (최대 4 items — 25 한계 여유)
  await args.doc.send(
    new TransactWriteCommand({ TransactItems: plan.primaryItems }),
  );

  // secondary batch deletes — 25개씩 분할
  if (plan.secondaryDeletes.length > 0) {
    // 테이블별 그룹핑
    const byTable = new Map<string, Array<{ key: Record<string, unknown> }>>();
    for (const d of plan.secondaryDeletes) {
      if (!byTable.has(d.table)) byTable.set(d.table, []);
      byTable.get(d.table)!.push({ key: d.key });
    }
    for (const [tableName, items] of byTable) {
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        await args.doc.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableName]: chunk.map((it) => ({ DeleteRequest: { Key: it.key } })),
            },
          }),
        );
      }
    }
  }

  // TODO: Cognito AdminDisableUser 호출 — v5.0 단순화로 생략.
  // PreSignUp trigger 가 status="removed" 를 차단하므로 보안상 충분.

  return { memberId: args.memberId };
}

// ─── assignMemberToTeam / unassignMemberFromTeam ──────────────────────────────

export async function assignMemberToTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
  teamId: string;
}): Promise<{ memberId: string; teamId: string }> {
  requireRoleAtLeast(args.caller, "manager");

  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");

  // idempotent — 이미 있어도 Put 으로 덮어쓰기
  await args.doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: args.tables.MemberTeams,
            Item: { memberId: args.memberId, teamId: args.teamId },
          },
        },
      ],
    }),
  );

  return { memberId: args.memberId, teamId: args.teamId };
}

export async function unassignMemberFromTeam(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
  teamId: string;
}): Promise<{ memberId: string; teamId: string }> {
  requireRoleAtLeast(args.caller, "manager");

  await args.doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: args.tables.MemberTeams,
            Key: { memberId: args.memberId, teamId: args.teamId },
          },
        },
      ],
    }),
  );

  return { memberId: args.memberId, teamId: args.teamId };
}
