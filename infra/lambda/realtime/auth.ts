import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PAGE_TABLE = process.env.PAGE_TABLE!;

// Cognito ID 토큰 검증기 — USER_POOL_ID·USER_POOL_CLIENT_ID 는 CDK 스택에서 주입
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: "id",
  clientId: process.env.USER_POOL_CLIENT_ID!,
});

export type AuthContext = { userId: string; pageId: string; workspaceId: string };

/**
 * WS $connect 인가 진입점.
 * Cognito ID 토큰 검증 후 페이지 존재 여부·워크스페이스 귀속을 확인한다.
 * 검증 실패 또는 페이지 미존재 시 null 반환 → $connect handler 가 403 으로 거부.
 *
 * 워크스페이스 멤버십 정밀 인가(WorkspaceAccess·MemberTeams 조회)는 후속 과제.
 */
export async function authorizeConnect(token: string, pageId: string): Promise<AuthContext | null> {
  // 필수 파라미터 누락 시 즉시 거부
  if (!token || !pageId) return null;

  // Cognito ID 토큰 서명·만료 검증
  let userId: string;
  try {
    const payload = await verifier.verify(token);
    userId = payload.sub;
  } catch {
    // 서명 불일치·만료 등 검증 실패
    return null;
  }

  // 페이지 존재 여부 및 워크스페이스 귀속 확인
  const page = await ddb.send(new GetCommand({ TableName: PAGE_TABLE, Key: { id: pageId } }));
  const workspaceId = page.Item?.workspaceId as string | undefined;
  if (!workspaceId) return null;

  return { userId, pageId, workspaceId };
}
