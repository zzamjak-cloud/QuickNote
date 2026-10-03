// 협업 룸 fan-out — 서버가 만든 Y update 를 룸의 모든 WS 연결에 push 한다(realtime/sync.ts 의 update 브로드캐스트와 같은 규약).
// WS 관리 엔드포인트는 RealtimeCollabStack 이 SSM 파라미터로 게시한다(스택 순환 참조 회피).
import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { leaveRoom, roomConnections } from "../realtime/connections";
import { newMsgId, serializeServerMessage, splitMessage } from "../realtime/protocol";

export type BroadcastResult = { connections: number; delivered: number; gone: number; skipped?: string };

const MAX_ATTEMPTS = 3;

let endpointPromise: Promise<string | null> | null = null;
let apiClient: { endpoint: string; client: ApiGatewayManagementApiClient } | null = null;

async function readEndpointParameter(name: string): Promise<string | null> {
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: name }));
  return r.Parameter?.Value || null;
}

/** env 직접 지정(테스트·격리 배포) > SSM 파라미터. 성공한 값만 캐시한다. */
export async function resolveWsEndpoint(): Promise<string | null> {
  const direct = process.env.COLLAB_WS_MANAGEMENT_ENDPOINT;
  if (direct) return direct;
  const param = process.env.COLLAB_WS_ENDPOINT_PARAM;
  if (!param) return null;
  endpointPromise ??= readEndpointParameter(param).catch((err) => {
    console.error("mcp WS 관리 엔드포인트 조회 실패", err);
    endpointPromise = null;
    return null;
  });
  return endpointPromise;
}

function clientFor(endpoint: string): ApiGatewayManagementApiClient {
  if (apiClient?.endpoint !== endpoint) {
    apiClient = { endpoint, client: new ApiGatewayManagementApiClient({ endpoint }) };
  }
  return apiClient.client;
}

type PostOutcome = "delivered" | "gone" | "failed";

// sync.ts post 와 동일: 28KB 초과는 chunk 분할, Gone 은 룸·APIGW 연결 정리, 일시 오류는 짧은 백오프 재시도.
async function postFrames(api: ApiGatewayManagementApiClient, target: string, data: string): Promise<PostOutcome> {
  for (const frame of splitMessage(data, newMsgId())) {
    let sent = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !sent; attempt += 1) {
      try {
        await api.send(new PostToConnectionCommand({ ConnectionId: target, Data: Buffer.from(frame) }));
        sent = true;
      } catch (e: unknown) {
        if ((e as { name?: string }).name === "GoneException") {
          await leaveRoom(target).catch(() => undefined);
          await api.send(new DeleteConnectionCommand({ ConnectionId: target })).catch(() => undefined);
          return "gone";
        }
        if (attempt === MAX_ATTEMPTS - 1) return "failed";
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  }
  return "delivered";
}

/**
 * room 의 모든 연결에 `{t:"update"}` 를 보낸다. 실패해도 throw 하지 않는다 —
 * update 는 이미 룸 로그에 영속됐으므로 놓친 클라는 다음 hello(재연결·탭 복귀) 때 diff 로 받는다.
 */
export async function broadcastRoomUpdate(room: string, update: Uint8Array): Promise<BroadcastResult> {
  try {
    const targets = await roomConnections(room);
    if (targets.length === 0) return { connections: 0, delivered: 0, gone: 0 };
    const endpoint = await resolveWsEndpoint();
    if (!endpoint) {
      console.error("mcp 브로드캐스트 생략: WS 관리 엔드포인트 미설정", { room });
      return { connections: targets.length, delivered: 0, gone: 0, skipped: "endpoint-unavailable" };
    }
    const api = clientFor(endpoint);
    const data = serializeServerMessage({ t: "update", update });
    const outcomes = await Promise.all(targets.map((id) => postFrames(api, id, data)));
    return {
      connections: targets.length,
      delivered: outcomes.filter((o) => o === "delivered").length,
      gone: outcomes.filter((o) => o === "gone").length,
    };
  } catch (err) {
    console.error("mcp 룸 브로드캐스트 실패", { room }, err);
    return { connections: 0, delivered: 0, gone: 0, skipped: "error" };
  }
}

/** 테스트 전용: 모듈 캐시 초기화. */
export function resetWsBroadcastCache(): void {
  endpointPromise = null;
  apiClient = null;
}
