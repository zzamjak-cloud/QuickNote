// 토큰별 분당 호출 제한 — ai-proxy checkRateLimit 과 같은 DDB 원자 카운터 패턴(ai-usage 테이블 공용).
import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const MCP_RATE_LIMIT_RPM = 120;

/** 한도 이내면 null, 초과면 다음 분까지 남은 초. */
export async function checkTokenRateLimit(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  tokenId: string;
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
        ":one": 1,
        ":exp": Math.floor(nowMs / 1000) + 180, // TTL 로 자동 정리
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const count = Number(r.Attributes?.cnt ?? 0);
  if (count <= (args.limit ?? MCP_RATE_LIMIT_RPM)) return null;
  return 60 - Math.floor((nowMs % 60_000) / 1000);
}
