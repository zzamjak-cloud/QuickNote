// AppSync JS 리졸버 공용 인증/권한 헬퍼.
// 모든 mutation/query 리졸버는 첫 단계에서 이 모듈의 함수 중 하나 이상을 호출해야 한다.
// pure 함수 위주라 단위 테스트 가능. AppSync 런타임에서는 ctx 객체와 결합해서 사용.

export type AccessLevel = "edit" | "view";
export type SubjectType = "team" | "member" | "everyone";
export type AccessEntry = {
  subjectType: SubjectType;
  subjectId: string | null;
  level: AccessLevel;
};
export type WorkspaceRole = "owner" | "manager" | "member";
export type MemberStatus = "active" | "removed";

const LEVEL_RANK: Record<AccessLevel, number> = { edit: 2, view: 1 };
const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 3, manager: 2, member: 1 };

// 워크스페이스 access entries + 사용자 멤버십 → effective level (없으면 null).
export function computeEffectiveLevel(
  entries: AccessEntry[],
  memberId: string,
  memberTeamIds: string[],
): AccessLevel | null {
  let best: AccessLevel | null = null;
  const teamSet = new Set(memberTeamIds);
  for (const e of entries) {
    let match = false;
    if (e.subjectType === "everyone") match = true;
    else if (e.subjectType === "member") match = e.subjectId === memberId;
    else if (e.subjectType === "team") match = e.subjectId !== null && teamSet.has(e.subjectId);
    if (!match) continue;
    if (best === null || LEVEL_RANK[e.level] > LEVEL_RANK[best]) best = e.level;
  }
  return best;
}

// actual ≥ required 인지 비교.
export function isAtLeast(actual: AccessLevel | null, required: AccessLevel): boolean {
  if (actual === null) return false;
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

// 워크스페이스 역할 비교 (owner > manager > member).
export function hasRoleAtLeast(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

// AppSync 리졸버에서 throw — errorType 으로 분류 노출.
function makeError(message: string, errorType: string): Error {
  const err = new Error(message) as Error & { errorType?: string };
  err.errorType = errorType;
  return err;
}

export function unauthorized(message: string): never {
  throw makeError(message, "Unauthorized");
}

export function forbidden(message: string): never {
  throw makeError(message, "Forbidden");
}

export function badRequest(message: string): never {
  throw makeError(message, "BadRequest");
}

// 호출자가 owner 가 아닌데 target 이 owner 이면 거부.
// promote/demote/transfer/remove 등에서 사용.
export function preventOwnerMutation(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): void {
  if (targetRole === "owner" && callerRole !== "owner") {
    forbidden("Owner 는 Owner 본인만 변경할 수 있습니다.");
  }
}
