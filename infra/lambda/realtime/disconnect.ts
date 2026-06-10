import type { APIGatewayProxyHandler } from "aws-lambda";
import { leaveRoom } from "./connections";

// WebSocket $disconnect 핸들러: 커넥션 테이블에서 룸 퇴장 처리
export const handler: APIGatewayProxyHandler = async (event) => {
  await leaveRoom(event.requestContext.connectionId!);
  return { statusCode: 200, body: "disconnected" };
};
