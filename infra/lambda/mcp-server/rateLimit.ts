// 토큰별 분당 호출 제한 — ai-proxy checkRateLimit 과 같은 DDB 원자 카운터 패턴(ai-usage 테이블 공용).
import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const MCP_RATE_LIMIT_RPM = 120;

/** 한도 이내면 null, 초과면 다음 분까지 남은 초. units 만큼 분당 카운터를 올린다(무거운 스캔 추가 차감용). */
export async function checkTokenRateLimit(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  tokenId: string;
  units?: number;
  limit?: number;
  nowMs?: number;
}): Promise<number | null> {
  const nowMs = args.nowMs ?? Date.now();
  const minute = Math.floor(nowMs / 60_000);
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { pk: `mcp-rl#${args.tokenId}`, sk: String(minute) },
      UpdateExpression: "ADD cnt :one SET expiresAt = :exp",
      ExpressionAttributeValues: {
        ":one": Math.max(1, Math.floor(args.units ?? 1)),
        ":exp": Math.floor(nowMs / 1000) + 180, // TTL 로 자동 정리
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const count = Number(r.Attributes?.cnt ?? 0);
  if (count <= (args.limit ?? MCP_RATE_LIMIT_RPM)) return null;
  return 60 - Math.floor((nowMs % 60_000) / 1000);
}

export const MCP_DAILY_WRITE_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyWriteResult = { ok: true } | { ok: false; limit: number; resetAt: string };

/** env MCP_DAILY_WRITE_LIMIT(양의 정수) > 기본 500. */
export function dailyWriteLimit(): number {
  const n = Number(process.env.MCP_DAILY_WRITE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : MCP_DAILY_WRITE_LIMIT;
}

/** 토큰별 일일(UTC) 쓰기 카운터 — 쓰는 페이지 수(units)만큼 증가, 한도 초과 시 다음 UTC 자정을 돌려준다. */
export async function consumeDailyWrite(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  tokenId: string;
  units?: number;
  limit?: number;
  nowMs?: number;
}): Promise<DailyWriteResult> {
  const nowMs = args.nowMs ?? Date.now();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { pk: `mcp-wd#${args.tokenId}#${day}`, sk: "writes" },
      UpdateExpression: "ADD cnt :inc SET expiresAt = :exp",
      ExpressionAttributeValues: {
        ":inc": Math.max(1, Math.floor(args.units ?? 1)),
        ":exp": Math.floor(nowMs / 1000) + 2 * 24 * 60 * 60, // TTL 2일
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const limit = args.limit ?? dailyWriteLimit();
  if (Number(r.Attributes?.cnt ?? 0) <= limit) return { ok: true };
  return { ok: false, limit, resetAt: new Date((Math.floor(nowMs / DAY_MS) + 1) * DAY_MS).toISOString() };
}
