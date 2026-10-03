// 협업 룸 epoch 불일치 가드 — 서버 COLLAB_ROOM_EPOCH 가 클라 빌드 epoch 과 다르면 MCP 는 아무도 보지 않는 룸에 쓰고,
// 실제 클라는 자기 epoch 룸을 권위로 삼아 8초 뒤 materialize 로 MCP 쓰기를 조용히 덮어쓴다(성공 응답 + 유실).
// rt-ydoc·rt-ydoc-updates 는 TTL 이 없어 옛 세대 룸이 영구 잔존하고(MCP 쓰기도 옛 룸을 되살린다),
// "서버 epoch 이 관측되는가" 만으로는 클라만 bump 된 상황을 못 막는다. 그래서 두 신호로 판정한다:
//  (a) 관측된 최대 epoch 이 서버 epoch 보다 크면 → 클라가 앞서 있음 → 거부
//  (b) rt-connections(TTL 3h, 현재 활성 신호)에 연결이 있는데 서버 epoch 이 없으면 → 거부
import { ScanCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ToolError, type McpContext } from "./context";

export const EPOCH_SAMPLE_LIMIT = 100;
export const EPOCH_CACHE_TTL_MS = 10 * 60 * 1000;
const ROOM_EPOCH_RE = /^(?:db:)?(v\d+):/;

// 표본 대상: rt-ydoc-updates·rt-ydoc 은 PK pageId(=room), rt-connections 는 pageId 속성(=room).
const STORED_TABLE_ENVS = ["YDOC_UPDATES_TABLE", "YDOC_TABLE"] as const;
const ACTIVE_TABLE_ENV = "CONNECTIONS_TABLE";

/** stored: 영구 룸 저장소에서 본 epoch, active: 현재 WS 연결의 epoch. */
export type ObservedEpochs = { stored: Set<string>; active: Set<string> };

let cache: { at: number; epochs: ObservedEpochs } | null = null;

/** "v12" → 12. 형식이 다르면 null. */
export function epochNumber(epoch: string): number | null {
  const m = /^v(\d+)$/.exec(epoch);
  return m ? Number(m[1]) : null;
}

export function epochOfRoom(room: unknown): string | null {
  return typeof room === "string" ? ROOM_EPOCH_RE.exec(room)?.[1] ?? null : null;
}

async function sampleTable(doc: DynamoDBDocumentClient, tableName: string): Promise<string[]> {
  const r = await doc.send(new ScanCommand({
    TableName: tableName,
    Limit: EPOCH_SAMPLE_LIMIT,
    ProjectionExpression: "#r",
    ExpressionAttributeNames: { "#r": "pageId" },
  }));
  return (r.Items ?? []).map((it) => epochOfRoom(it.pageId)).filter((e): e is string => e !== null);
}

async function sampleEnvTables(doc: DynamoDBDocumentClient, envNames: readonly string[]): Promise<Set<string>> {
  const tables = envNames.map((name) => process.env[name]).filter((t): t is string => Boolean(t));
  return new Set((await Promise.all(tables.map((t) => sampleTable(doc, t)))).flat());
}

/** 관측된 room epoch(컨테이너 캐시, TTL 10분). 조회 실패는 캐시하지 않는다. */
export async function observedEpochs(doc: DynamoDBDocumentClient, nowMs = Date.now()): Promise<ObservedEpochs> {
  if (cache && nowMs - cache.at < EPOCH_CACHE_TTL_MS) return cache.epochs;
  const [stored, active] = await Promise.all([
    sampleEnvTables(doc, STORED_TABLE_ENVS),
    sampleEnvTables(doc, [ACTIVE_TABLE_ENV]),
  ]);
  const epochs = { stored, active };
  cache = { at: nowMs, epochs };
  return epochs;
}

/** 거부 사유(없으면 null). 표본이 비면 허용한다. */
export function epochMismatchReason(server: string, observed: ObservedEpochs): string | null {
  const serverNum = epochNumber(server);
  const all = [...new Set([...observed.stored, ...observed.active])];
  const newest = Math.max(-1, ...all.map((e) => epochNumber(e) ?? -1));
  if (serverNum !== null && newest > serverNum) return `newer epoch v${newest} is in use`;
  if (observed.active.size > 0 && !observed.active.has(server)) return "no active connection uses the server epoch";
  return null;
}

/** 본문·셀 쓰기 전 호출. 표본 조회가 실패하면 유실 위험을 피해 거부한다. */
export async function requireCollabEpoch(ctx: McpContext): Promise<void> {
  let observed: ObservedEpochs;
  try {
    observed = await observedEpochs(ctx.doc);
  } catch (err) {
    console.error("mcp epoch 표본 조회 실패", err);
    throw new ToolError("EPOCH_CHECK_FAILED: could not verify the collaboration room epoch; body/property writes are blocked. Try again later.");
  }
  const reason = epochMismatchReason(ctx.collabRoomEpoch, observed);
  if (!reason) return;
  const list = (set: Set<string>) => [...set].sort().join(", ") || "none";
  console.error("mcp epoch 불일치", { server: ctx.collabRoomEpoch, stored: [...observed.stored], active: [...observed.active] });
  throw new ToolError(
    `EPOCH_MISMATCH: server collab epoch "${ctx.collabRoomEpoch}" — ${reason} ` +
      `(observed rooms: ${list(observed.stored)}; active connections: ${list(observed.active)}). ` +
      "Body/property writes are blocked to avoid silent data loss; ask the QuickNote admin to align COLLAB_ROOM_EPOCH with the client build.",
  );
}

/** 테스트 전용: 캐시 초기화. */
export function resetEpochCache(): void {
  cache = null;
}
