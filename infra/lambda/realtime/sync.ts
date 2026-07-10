import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { ClientMessage } from "./protocol";
import {
  parseClientMessage,
  serializeServerMessage,
  parseChunk,
  splitMessage,
  newMsgId,
} from "./protocol";
import { collectChunk } from "./chunks";
import { loadPageState, appendPageUpdate, diffForClient, stateVectorOf } from "./yjsStore";
import { roomConnections, leaveRoom } from "./connections";
import { buildDbSeedUpdate } from "./dbSeed";
import { parseRoom } from "./room";

/** awareness 메시지인지 — true 면 영속하지 않고 룸 fan-out 만 한다. */
export function isAwarenessMessage(msg: ClientMessage): boolean {
  return msg.t === "awareness";
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

// WebSocket $default(sync) 핸들러: 클라이언트 메시지 파싱 후 상태 동기화 또는 브로드캐스트 수행
export const handler: APIGatewayProxyHandler = async (event) => {
  // keepalive ping — 연결 유지(idle timeout 연장)만 목적이므로 커넥션 조회·상태 로드 없이
  // 즉시 응답한다. hello 로 keepalive 하면 25초마다 룸 전체 상태 로드가 발생해 비용이 크다.
  if (parseClientMessage(event.body ?? "")?.t === "ping") {
    return { statusCode: 200, body: "pong" };
  }

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  // API Gateway Management API 클라이언트 (연결별 엔드포인트)
  const api = new ApiGatewayManagementApiClient({ endpoint: `https://${domain}/${stage}` });

  // 커넥션 테이블에서 pageId 조회
  const conn = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
  const pageId = conn.Item?.pageId as string | undefined;
  if (!pageId) return { statusCode: 403, body: "no room" };

  // 클라이언트 메시지(텍스트 JSON). chunk 면 누적하고, 모든 청크가 도착해야 원본으로 처리한다.
  let body = event.body ?? "";
  const chunk = parseChunk(body);
  if (chunk) {
    const assembled = await collectChunk(connectionId, chunk);
    if (!assembled) return { statusCode: 200, body: "chunk buffered" };
    body = assembled;
  }

  const msg = parseClientMessage(body);
  if (!msg) return { statusCode: 400, body: "bad message" };

  /**
   * 특정 커넥션에 메시지를 전송한다. 28KB 초과 메시지는 chunk 로 분할한다.
   * GoneException(끊긴 연결) 발생 시 룸에서 제거하고 APIGW 연결도 삭제한다.
   * 일시 오류(throttle 등)는 짧은 백오프로 재시도한다 — 다중 프레임 메시지가 중간에
   * 끊기면 수신측 재조립이 영구 미완성이 되어 sync 자체가 불발되기 때문(입력 차단 사고).
   */
  const post = async (target: string, data: string) => {
    const frames = splitMessage(data, newMsgId());
    for (const f of frames) {
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        try {
          await api.send(
            new PostToConnectionCommand({ ConnectionId: target, Data: Buffer.from(f) }),
          );
          sent = true;
        } catch (e: unknown) {
          if ((e as { name?: string }).name === "GoneException") {
            // 스테일 커넥션 정리: DynamoDB 레코드 삭제 + APIGW 연결 해제
            await leaveRoom(target);
            await api.send(new DeleteConnectionCommand({ ConnectionId: target })).catch(() => {});
            return; // 끊긴 연결 — 남은 프레임 전송 무의미.
          }
          if (attempt === 2) return; // 재시도 소진 — 부분 전송은 수신측 재연결 시 폐기된다.
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
  };

  if (msg.t === "hello") {
    // 초기 핸드셰이크: 서버 상태와 클라이언트 sv 를 비교해 diff 만 전송
    let state = await loadPageState(pageId);
    // DB room 첫 진입: 서버 권위 구조 시드(중복 컬럼 방지). 빈 Y.Doc 일 때만.
    if (pageId.startsWith("db:")) {
      const sv = stateVectorOf(state);
      const isEmpty = sv.length <= 1; // 빈 Y.Doc 의 state vector 길이
      if (isEmpty) {
        // room 문자열에는 epoch 솔트가 섞여 있으므로 실제 DB id 는 parseRoom 으로 추출한다.
        const seed = await buildDbSeedUpdate(parseRoom(pageId).id);
        if (seed) {
          await appendPageUpdate(pageId, seed);
          state = await loadPageState(pageId);
        }
      }
    }
    const reply = serializeServerMessage({
      t: "sync",
      update: diffForClient(state, msg.sv),
      sv: stateVectorOf(state),
    });
    await post(connectionId, reply);
    return { statusCode: 200, body: "synced" };
  }

  // 상단 fast-path 가 처리하지만, chunk 로 도착한 ping 도 동일하게 응답한다(타입 내로잉 겸용).
  if (msg.t === "ping") return { statusCode: 200, body: "pong" };

  if (isAwarenessMessage(msg)) {
    // 휘발성: 영속 없이 같은 룸 피어로 릴레이만 한다.
    const targets = (await roomConnections(pageId)).filter((id) => id !== connectionId);
    const awFrame = serializeServerMessage({ t: "awareness", update: (msg as { update: Uint8Array }).update });
    await Promise.all(targets.map((id) => post(id, awFrame)));
    return { statusCode: 200, body: "awareness" };
  }

  // update 메시지: DynamoDB 에 append 후 동일 룸의 다른 커넥션에 브로드캐스트.
  // append 실패는 그 편집이 룸 권위에서 이탈하는 것(클라는 fire-and-forget 이라 인지 못함)
  // — 일시 오류(throttle 등)는 1회 재시도로 흡수한다. 최종 실패는 클라의 다음 hello 재조정
  // (sv-reply 조건부 재전송)이 복구한다.
  try {
    await appendPageUpdate(pageId, msg.update);
  } catch {
    await new Promise((r) => setTimeout(r, 150));
    await appendPageUpdate(pageId, msg.update);
  }
  const targets = (await roomConnections(pageId)).filter((id) => id !== connectionId);
  const broadcast = serializeServerMessage({ t: "update", update: msg.update });
  await Promise.all(targets.map((id) => post(id, broadcast)));
  return { statusCode: 200, body: "ok" };
};
