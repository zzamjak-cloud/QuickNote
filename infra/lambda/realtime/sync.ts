import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { parseClientMessage, serializeServerMessage } from "./protocol";
import { loadPageState, appendPageUpdate, diffForClient, stateVectorOf } from "./yjsStore";
import { roomConnections, leaveRoom } from "./connections";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

// WebSocket $default(sync) 핸들러: 클라이언트 메시지 파싱 후 상태 동기화 또는 브로드캐스트 수행
export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  // API Gateway Management API 클라이언트 (연결별 엔드포인트)
  const api = new ApiGatewayManagementApiClient({ endpoint: `https://${domain}/${stage}` });

  // 커넥션 테이블에서 pageId 조회
  const conn = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
  const pageId = conn.Item?.pageId as string | undefined;
  if (!pageId) return { statusCode: 403, body: "no room" };

  // 클라이언트 메시지 파싱
  const msg = parseClientMessage(event.body ?? "");
  if (!msg) return { statusCode: 400, body: "bad message" };

  /**
   * 특정 커넥션에 메시지를 전송한다.
   * GoneException(끊긴 연결) 발생 시 룸에서 제거하고 APIGW 연결도 삭제한다.
   */
  const post = async (target: string, data: string) => {
    try {
      await api.send(
        new PostToConnectionCommand({ ConnectionId: target, Data: Buffer.from(data) })
      );
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "GoneException") {
        // 스테일 커넥션 정리: DynamoDB 레코드 삭제 + APIGW 연결 해제
        await leaveRoom(target);
        await api.send(new DeleteConnectionCommand({ ConnectionId: target })).catch(() => {});
      }
    }
  };

  if (msg.t === "hello") {
    // 초기 핸드셰이크: 서버 상태와 클라이언트 sv 를 비교해 diff 만 전송
    const state = await loadPageState(pageId);
    const reply = serializeServerMessage({
      t: "sync",
      update: diffForClient(state, msg.sv),
      sv: stateVectorOf(state),
    });
    await post(connectionId, reply);
    return { statusCode: 200, body: "synced" };
  }

  // update 메시지: DynamoDB 에 append 후 동일 룸의 다른 커넥션에 브로드캐스트
  await appendPageUpdate(pageId, msg.update);
  const targets = (await roomConnections(pageId)).filter((id) => id !== connectionId);
  const broadcast = serializeServerMessage({ t: "update", update: msg.update });
  await Promise.all(targets.map((id) => post(id, broadcast)));
  return { statusCode: 200, body: "ok" };
};
