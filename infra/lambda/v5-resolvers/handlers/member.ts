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
  ResolverError,
  type Member,
  type WorkspaceRole,
} from "./_auth";

export type Tables = {
  Members: string;
  Teams: string;
  MemberTeams: string;
  Workspaces: string;
  WorkspaceAccess: string;
  Pages?: string;
  Databases?: string;
  Comments?: string;
  Notifications?: string;
  /** 조직(실) 테이블 */
  Organizations?: string;
  /** 멤버-조직 관계 테이블 (memberId PK, organizationId SK) */
  MemberOrganizations?: string;
  /** LC 스케줄러 일정 테이블 */
  Schedules?: string;
  /** LC 스케줄러 프로젝트 테이블 */
  Projects?: string;
  /** LC 스케줄러 공휴일 테이블 */
  Holidays?: string;
  /** LC 스케줄러 주간 MM 원본/리비전 테이블 */
  MmEntries?: string;
};

export type CreateMemberInput = {
  email: string;
  name: string;
  jobRole: string;
  workspaceRole?: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER";
  teamIds?: string[] | null;
};

type MemberFilterInput = {
  status?: "ACTIVE" | "REMOVED";
  teamId?: string;
  workspaceRole?: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER";
};

type TxItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
export type { Member };

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
        rowCount: 1,
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
  requireRoleAtLeast(args.caller, "leader");
  const inputRole = (args.input.workspaceRole ?? "MEMBER").toLowerCase();
  // DEVELOPER 등록은 Developer 만
  if (inputRole === "developer" && args.caller.workspaceRole !== "developer") {
    badRequest("Developer 만 Developer 등록 가능");
  }
  // OWNER 등록은 Developer 만
  if (inputRole === "owner" && args.caller.workspaceRole !== "developer") {
    badRequest("Developer 만 Owner 등록 가능");
  }
  // LEADER 등록은 Developer, Owner 만
  if (inputRole === "leader" && !["developer", "owner"].includes(args.caller.workspaceRole)) {
    badRequest("Owner 이상만 Leader 등록 가능");
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
    rowCount: 1,
    createdAt: now,
  };
}

export async function listMembers(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  filter?: MemberFilterInput;
}): Promise<Member[]> {
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
  jobTitle?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  thumbnailUrl?: string | null;
  teamIds?: string[] | null;
  /** 재직 상태 (재직중 | 휴직 | 병가 | 퇴사) */
  employmentStatus?: string | null;
  /** 사번 */
  employeeNumber?: string | null;
  /** 소속(실) */
  department?: string | null;
  /** 소속(팀) 명칭 */
  team?: string | null;
  /** 직무 카테고리 */
  jobCategory?: string | null;
  /** 상세직무 */
  jobDetail?: string | null;
  /** 입사일 (YYYY-MM-DD) */
  joinedAt?: string | null;
  /** 구성원별 타임라인 행 개수 */
  rowCount?: number | null;
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
  const exprNames: Record<string, string> = {};
  if (args.input.name != null) { sets.push("#name = :n"); vals[":n"] = args.input.name; exprNames["#name"] = "name"; }
  if (args.input.jobRole != null) { sets.push("jobRole = :j"); vals[":j"] = args.input.jobRole; }
  if (args.input.jobTitle !== undefined) { sets.push("jobTitle = :jt"); vals[":jt"] = args.input.jobTitle ?? null; }
  if (args.input.phone !== undefined) { sets.push("phone = :ph"); vals[":ph"] = args.input.phone ?? null; }
  if (args.input.avatarUrl !== undefined) { sets.push("avatarUrl = :av"); vals[":av"] = args.input.avatarUrl ?? null; }
  if (args.input.thumbnailUrl !== undefined) { sets.push("thumbnailUrl = :th"); vals[":th"] = args.input.thumbnailUrl ?? null; }
  // 신규 필드 — CSV 마이그레이션 및 설정 UI 에서 설정
  if (args.input.employmentStatus !== undefined) { sets.push("employmentStatus = :es"); vals[":es"] = args.input.employmentStatus ?? null; }
  if (args.input.employeeNumber !== undefined) { sets.push("employeeNumber = :en"); vals[":en"] = args.input.employeeNumber ?? null; }
  if (args.input.department !== undefined) { sets.push("department = :dep"); vals[":dep"] = args.input.department ?? null; }
  if (args.input.team !== undefined) { sets.push("#team = :tm"); vals[":tm"] = args.input.team ?? null; exprNames["#team"] = "team"; }
  if (args.input.jobCategory !== undefined) { sets.push("jobCategory = :jc"); vals[":jc"] = args.input.jobCategory ?? null; }
  if (args.input.jobDetail !== undefined) { sets.push("jobDetail = :jd"); vals[":jd"] = args.input.jobDetail ?? null; }
  if (args.input.joinedAt !== undefined) { sets.push("joinedAt = :ja"); vals[":ja"] = args.input.joinedAt ?? null; }
  if (args.input.rowCount !== undefined) { sets.push("rowCount = :rc"); vals[":rc"] = args.input.rowCount ?? 1; }

  let updated: Member = target;
  if (sets.length > 0) {
    const r = await args.doc.send(
      new UpdateCommand({
        TableName: args.tables.Members,
        Key: { memberId: args.input.memberId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeValues: vals,
        ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
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

/** v1 클라이언트 prefs — 즐겨찾기 동기화. */
export type ClientPrefsPayloadV1 = {
  v: 1;
  favoritePageIds: string[];
  favoritePageIdsUpdatedAt: number;
};

const MAX_SYNCED_FAVORITES = 500;
const MAX_PAGE_ID_CHARS = 128;

function parseClientPrefsStored(raw: unknown): ClientPrefsPayloadV1 | null {
  if (raw == null || raw === "") return null;
  const str = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    const o = JSON.parse(str) as Record<string, unknown>;
    if (Number(o.v) !== 1) return null;
    if (!Array.isArray(o.favoritePageIds)) return null;
    const favoritePageIds = o.favoritePageIds.map(String);
    const ts = Number(o.favoritePageIdsUpdatedAt);
    if (!Number.isFinite(ts) || ts < 0) return null;
    return {
      v: 1,
      favoritePageIds,
      favoritePageIdsUpdatedAt: ts,
    };
  } catch {
    return null;
  }
}

/**
 * 호출자 본인(clientPrefs 저장)만 허용. Manager 권한 불필요.
 * LWW: favoritePageIdsUpdatedAt 이 기존보다 작으면 업데이트하지 않음.
 */
export async function updateMyClientPrefs(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { clientPrefs: string };
}): Promise<Member> {
  const target = await getMemberById(args.doc, args.tables, args.caller.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");

  let incoming: ClientPrefsPayloadV1;
  try {
    const o = JSON.parse(args.input.clientPrefs) as Record<string, unknown>;
    if (Number(o.v) !== 1) badRequest("지원하지 않는 clientPrefs 버전");
    if (!Array.isArray(o.favoritePageIds)) {
      badRequest("favoritePageIds 가 배열이 아닙니다");
    }
    const favoritePageIds = o.favoritePageIds.map(String);
    if (favoritePageIds.length > MAX_SYNCED_FAVORITES) badRequest("즐겨찾기 최대 개수 초과");
    for (const id of favoritePageIds) {
      if (id.length > MAX_PAGE_ID_CHARS) badRequest("페이지 ID 길이 초과");
    }
    const favoritePageIdsUpdatedAt = Number(o.favoritePageIdsUpdatedAt);
    if (!Number.isFinite(favoritePageIdsUpdatedAt) || favoritePageIdsUpdatedAt < 0) {
      badRequest("favoritePageIdsUpdatedAt 가 유효하지 않습니다");
    }
    incoming = {
      v: 1,
      favoritePageIds,
      favoritePageIdsUpdatedAt,
    };
  } catch (e) {
    if (e instanceof ResolverError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    badRequest(`clientPrefs 파싱 실패 — ${msg}`);
  }

  const existing = parseClientPrefsStored(target.clientPrefs ?? null);
  if (
    existing &&
    incoming.favoritePageIdsUpdatedAt < existing.favoritePageIdsUpdatedAt
  ) {
    return target;
  }

  const toSave = JSON.stringify(incoming satisfies ClientPrefsPayloadV1);
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Members,
      Key: { memberId: args.caller.memberId },
      UpdateExpression: "SET clientPrefs = :cp",
      ExpressionAttributeValues: { ":cp": toSave },
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as Member;
}

// ─── setMemberRole ────────────────────────────────────────────────────────────

export async function setMemberRole(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
  role: WorkspaceRole;
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "leader");
  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "active") badRequest("비활성 멤버");
  preventOwnerMutation(args.caller, target);
  if (target.workspaceRole === "owner") forbidden("Owner 는 권한 변경 불가");
  if (target.workspaceRole === "developer") forbidden("Developer 는 권한 변경 불가");

  // leader/owner 지정은 owner 이상만
  if (args.role === "leader" && !["developer", "owner"].includes(args.caller.workspaceRole)) {
    forbidden("Owner 이상만 Leader 지정 가능");
  }
  if (args.role === "owner") forbidden("transferOwnership 을 사용하세요");
  if (args.role === "developer") forbidden("Developer 권한은 변경 불가");

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Members,
      Key: { memberId: args.memberId },
      UpdateExpression: "SET workspaceRole = :r",
      ExpressionAttributeValues: { ":r": args.role },
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as Member;
}

// ─── promoteToManager ─────────────────────────────────────────────────────────

export async function promoteToManager(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "manager");
  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.workspaceRole === "owner") forbidden("Owner 는 권한 변경 불가");
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
  requireRoleAtLeast(args.caller, "manager");
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
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "leader");

  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.workspaceRole === "developer") forbidden("Developer 는 제거 불가");
  if (target.workspaceRole === "owner" && args.caller.workspaceRole !== "developer") {
    forbidden("Owner 는 제거 불가");
  }
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

  return { ...target, status: "removed", removedAt: now };
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

// ─── restoreMember ─────────────────────────────────────────────────────────────
export async function restoreMember(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  memberId: string;
}): Promise<Member> {
  requireRoleAtLeast(args.caller, "leader");

  const target = await getMemberById(args.doc, args.tables, args.memberId);
  if (!target) notFound("Member 없음");
  if (target.status !== "removed") badRequest("이미 활성 멤버");

  await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Members,
      Key: { memberId: args.memberId },
      UpdateExpression: "SET #s = :active REMOVE removedAt",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": "active" },
    }),
  );

  return { ...target, status: "active", removedAt: undefined };
}
