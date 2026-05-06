// Lambda router 의 권한 검증 helper. AppSync 의 ctx.identity.sub 로
// Members 테이블 GSI(byCognitoSub) 조회해 caller 의 active Member 를 찾는다.
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export type WorkspaceRole = "owner" | "manager" | "member";
export type Member = {
  memberId: string;
  email: string;
  name: string;
  jobRole: string;
  workspaceRole: WorkspaceRole;
  status: "active" | "removed";
  personalWorkspaceId: string;
  cognitoSub: string | null;
  createdAt: string;
  removedAt?: string | null;
};

const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 3, manager: 2, member: 1 };

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
