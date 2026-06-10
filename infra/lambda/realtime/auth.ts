import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerMember, hasWorkspaceViewAccess, ResolverError } from "../v5-resolvers/handlers/_auth";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PAGE_TABLE = process.env.PAGE_TABLE!;
const MEMBERS_TABLE = process.env.MEMBERS_TABLE!;
const MEMBER_TEAMS_TABLE = process.env.MEMBER_TEAMS_TABLE!;
const WORKSPACE_ACCESS_TABLE = process.env.WORKSPACE_ACCESS_TABLE!;

// Cognito ID 토큰 검증기 — USER_POOL_ID·USER_POOL_CLIENT_ID 는 CDK 스택에서 주입
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: "id",
  clientId: process.env.USER_POOL_CLIENT_ID!,
});

export type AuthContext = { userId: string; pageId: string; workspaceId: string; memberId: string };

/**
 * WS $connect 인가 진입점.
 * ① Cognito ID 토큰 검증 → ② 페이지 존재·워크스페이스 귀속 확인 →
 * ③ caller 의 active Member 조회 → ④ 해당 워크스페이스 view 권한(멤버십) 확인.
 * 어느 단계든 실패하면 null 반환 → $connect handler 가 401/403 으로 거부한다.
 *
 * 권한 규칙은 v5 리졸버의 hasWorkspaceViewAccess 와 동일(developer/owner/leader 암묵 허용 +
 * WorkspaceAccess 엔트리/team 매칭). edit 가 아닌 view 이상이면 연결을 허용한다 —
 * read-only 참가자도 라이브 본문을 받아볼 수 있어야 하기 때문(편집 게이팅은 클라이언트 권한이 별도 담당).
 */
export async function authorizeConnect(token: string, pageId: string): Promise<AuthContext | null> {
  // 필수 파라미터 누락 시 즉시 거부
  if (!token || !pageId) return null;

  // Cognito ID 토큰 서명·만료 검증
  let cognitoSub: string;
  try {
    const payload = await verifier.verify(token);
    cognitoSub = payload.sub;
  } catch {
    // 서명 불일치·만료 등 검증 실패
    return null;
  }

  // 페이지 존재 여부 및 워크스페이스 귀속 확인
  const page = await ddb.send(new GetCommand({ TableName: PAGE_TABLE, Key: { id: pageId } }));
  const workspaceId = page.Item?.workspaceId as string | undefined;
  if (!workspaceId) return null;

  // caller 멤버 조회 + 워크스페이스 멤버십(view 이상) 검증
  try {
    const caller = await getCallerMember(ddb, MEMBERS_TABLE, cognitoSub);
    const allowed = await hasWorkspaceViewAccess({
      doc: ddb,
      memberTeamsTableName: MEMBER_TEAMS_TABLE,
      workspaceAccessTableName: WORKSPACE_ACCESS_TABLE,
      caller,
      workspaceId,
    });
    if (!allowed) return null;
    return { userId: cognitoSub, pageId, workspaceId, memberId: caller.memberId };
  } catch (e) {
    // 미등록·비활성 멤버 등 ResolverError 는 인가 거부로 처리. 그 외 오류도 안전하게 거부.
    if (e instanceof ResolverError) return null;
    return null;
  }
}
