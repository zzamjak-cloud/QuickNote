// Lambda router 의 권한 검증 helper. AppSync 의 ctx.identity.sub 로
// Members 테이블 GSI(byCognitoSub) 조회해 caller 의 active Member 를 찾는다.
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export type WorkspaceRole = "developer" | "owner" | "leader" | "manager" | "member";
export type Member = {
  memberId: string;
  email: string;
  name: string;
  jobRole: string;
  workspaceRole: WorkspaceRole;
  status: "active" | "removed";
  personalWorkspaceId: string;
  cognitoSub: string | null;
  /** Member 테이블 JSON 문자열(클라이언트 즐겨찾기 등). */
  clientPrefs?: string | null;
  createdAt: string;
  removedAt?: string | null;
  rowCount?: number | null;
};

const ROLE_RANK: Record<WorkspaceRole, number> = { developer: 5, owner: 4, leader: 3, manager: 2, member: 1 };

export class ResolverError extends Error {
  constructor(message: string, public errorType: string) {
    super(message);
    this.name = "ResolverError";
  }
}

export function unauthorized(msg: string): never { throw new ResolverError(msg, "Unauthorized"); }
export function forbidden(msg: string): never { throw new ResolverError(msg, "Forbidden"); }
export function badRequest(msg: string): never { throw new ResolverError(msg, "BadRequest"); }
export function notFound(msg: string): never { throw new ResolverError(msg, "NotFound"); }

export async function getCallerMember(
  doc: DynamoDBDocumentClient,
  membersTableName: string,
  cognitoSub: string | undefined,
): Promise<Member> {
  if (!cognitoSub) unauthorized("identity 없음");
  const r = await doc.send(
    new QueryCommand({
      TableName: membersTableName,
      IndexName: "byCognitoSub",
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": cognitoSub },
      Limit: 1,
    }),
  );
  const m = r.Items?.[0] as Member | undefined;
  if (!m) unauthorized("등록된 멤버가 아닙니다");
  if (m.status !== "active") unauthorized("비활성 멤버");
  return m;
}

export function requireRoleAtLeast(caller: Member, required: WorkspaceRole): void {
  if (ROLE_RANK[caller.workspaceRole] < ROLE_RANK[required]) {
    forbidden(`권한 부족 — ${required} 이상 필요`);
  }
}

export function requireOwnerOnly(caller: Member): void {
  if (caller.workspaceRole !== "owner") forbidden("Owner 만 가능");
}

export function requireOwnerOrAbove(caller: Member): void {
  if (ROLE_RANK[caller.workspaceRole] < ROLE_RANK["owner"]) forbidden("Owner 이상만 가능");
}

export function preventOwnerMutation(caller: Member, target: Member): void {
  if (target.workspaceRole === "owner" && caller.memberId !== target.memberId) {
    forbidden("Owner 는 본인만 변경 가능");
  }
}

export type AccessLevel = "edit" | "view";
type SubjectType = "member" | "team" | "everyone";
type AccessEntry = { subjectType: SubjectType; subjectId: string | null; level: AccessLevel };

const LEVEL_RANK: Record<AccessLevel, number> = { edit: 2, view: 1 };
export const LC_SCHEDULER_WORKSPACE_ID = "lc-scheduler-global";
export const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";

export function isLCSchedulerDatabaseId(databaseId: string | null | undefined): boolean {
  return Boolean(databaseId?.startsWith(LC_SCHEDULER_DATABASE_ID_PREFIX));
}

export function getLCSchedulerWorkspaceIdFromDatabaseId(databaseId: string): string | null {
  if (!isLCSchedulerDatabaseId(databaseId)) return null;
  return databaseId.slice(LC_SCHEDULER_DATABASE_ID_PREFIX.length) || null;
}

export function isLCSchedulerScope(
  workspaceId: string | null | undefined,
  databaseId?: string | null,
): boolean {
  if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) return true;
  if (!workspaceId || !databaseId) return false;
  return getLCSchedulerWorkspaceIdFromDatabaseId(databaseId) === workspaceId;
}

async function getMemberTeamIds(
  doc: DynamoDBDocumentClient,
  memberTeamsTableName: string,
  memberId: string,
): Promise<string[]> {
  const r = await doc.send(
    new QueryCommand({
      TableName: memberTeamsTableName,
      KeyConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":m": memberId },
    }),
  );
  return (r.Items ?? []).map((i) => i["teamId"] as string);
}

async function getWorkspaceAccessEntries(
  doc: DynamoDBDocumentClient,
  workspaceAccessTableName: string,
  workspaceId: string,
): Promise<AccessEntry[]> {
  const r = await doc.send(
    new QueryCommand({
      TableName: workspaceAccessTableName,
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": workspaceId },
    }),
  );
  return (r.Items ?? []).map((i) => ({
    subjectType: i["subjectType"] as SubjectType,
    subjectId: (i["subjectId"] as string | undefined) ?? null,
    level: i["level"] as AccessLevel,
  }));
}

export function computeEffectiveLevel(
  entries: AccessEntry[],
  memberId: string,
  memberTeamIds: string[],
): AccessLevel | null {
  const teamSet = new Set(memberTeamIds);
  // 모든 매칭 엔트리 중 최고 레벨 반환 (everyone보다 member/team 전용 edit이 우선)
  let best: AccessLevel | null = null;
  for (const e of entries) {
    const matched =
      (e.subjectType === "member" && e.subjectId === memberId) ||
      (e.subjectType === "team" && e.subjectId !== null && teamSet.has(e.subjectId)) ||
      e.subjectType === "everyone";
    if (matched && (best === null || LEVEL_RANK[e.level] > LEVEL_RANK[best])) {
      best = e.level;
    }
  }
  return best;
}

export async function requireWorkspaceAccess(args: {
  doc: DynamoDBDocumentClient;
  memberTeamsTableName: string;
  workspaceAccessTableName: string;
  caller: Member;
  workspaceId: string;
  required: AccessLevel;
}): Promise<AccessLevel> {
  if (args.workspaceId === LC_SCHEDULER_WORKSPACE_ID) return "edit";

  // owner는 WorkspaceAccess 테이블 엔트리 없이도 암묵적으로 edit 권한을 가짐.
  // 개인 워크스페이스처럼 access 엔트리가 생성되지 않은 경우도 정상 동작.
  if (args.caller.workspaceRole === "developer" || args.caller.workspaceRole === "owner" || args.caller.workspaceRole === "leader") return "edit";

  const teamIds = await getMemberTeamIds(args.doc, args.memberTeamsTableName, args.caller.memberId);
  const entries = await getWorkspaceAccessEntries(args.doc, args.workspaceAccessTableName, args.workspaceId);
  const effective = computeEffectiveLevel(entries, args.caller.memberId, teamIds);
  if (!effective) forbidden("워크스페이스 접근 권한 없음");
  if (LEVEL_RANK[effective] < LEVEL_RANK[args.required]) {
    forbidden(`워크스페이스 ${args.required} 권한 필요`);
  }
  return effective;
}
