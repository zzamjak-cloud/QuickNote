import type { APIGatewayProxyHandler } from "aws-lambda";
import { authorizeConnect } from "./auth";
import { joinRoom } from "./connections";

// WebSocket $connect 핸들러: 토큰·pageId 검증 후 룸에 연결 등록
export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const token = event.queryStringParameters?.token ?? "";
  const pageId = event.queryStringParameters?.pageId ?? "";

  // Cognito 토큰 검증 및 페이지 귀속 확인
  const ctx = await authorizeConnect(token, pageId);
  if (!ctx) return { statusCode: 401, body: "unauthorized" };

  // DynamoDB 커넥션 테이블에 룸 참가 등록
  await joinRoom({ connectionId, pageId, userId: ctx.userId, workspaceId: ctx.workspaceId });
  return { statusCode: 200, body: "connected" };
};
