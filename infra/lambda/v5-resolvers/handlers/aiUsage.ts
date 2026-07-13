// AI 사용량 조회 — 총계는 전역(모든 워크스페이스 합산, 월 한도와 동일 기준),
// members 내역은 호출한 워크스페이스 기준. 개인별 내역 포함이라 developer 전용.
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { badRequest, type Member } from "./_auth";
import { GLOBAL_AI_CONFIG_ID, requireDeveloper } from "./aiConfig";
import type { Tables } from "./member";

export type AiUsageMemberEntryGql = {
  memberId: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
};

export type WorkspaceAiUsageGql = {
  workspaceId: string;
  month: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  members: AiUsageMemberEntryGql[];
};

function requireAiUsageTable(tables: Tables): string {
  const t = tables.AiUsage;
  if (!t) throw new Error("AI_USAGE_TABLE_NAME 미설정");
  return t;
}

export async function getWorkspaceAiUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  month?: string | null;
}): Promise<WorkspaceAiUsageGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  const month = (args.month ?? "").trim() || new Date().toISOString().slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(month)) badRequest("month 는 YYYYMM 형식");

  const table = requireAiUsageTable(args.tables);
  // 총계는 전역 누적(usage#__global__) — 월 토큰 한도(전역 설정)와 같은 기준.
  // 전역 누적은 전역 설정 전환(2026-07) 이후부터 쌓이므로 그 이전 사용분은 미포함.
  const [globalTotal, r] = await Promise.all([
    args.doc.send(
      new GetCommand({
        TableName: table,
        Key: { pk: `usage#${GLOBAL_AI_CONFIG_ID}`, sk: `${month}#__total` },
      }),
    ),
    args.doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p AND begins_with(sk, :m)",
        ExpressionAttributeValues: {
          ":p": `usage#${args.workspaceId}`,
          ":m": `${month}#`,
        },
      }),
    ),
  ]);

  const result: WorkspaceAiUsageGql = {
    workspaceId: args.workspaceId,
    month,
    inputTokens: Number(globalTotal.Item?.["inputTokens"] ?? 0),
    outputTokens: Number(globalTotal.Item?.["outputTokens"] ?? 0),
    requestCount: Number(globalTotal.Item?.["requestCount"] ?? 0),
    members: [],
  };
  for (const item of r.Items ?? []) {
    const sk = item["sk"] as string;
    const memberId = sk.slice(month.length + 1);
    if (memberId === "__total") continue; // 워크스페이스 총계는 미사용(총계는 전역 기준)
    result.members.push({
      memberId,
      inputTokens: Number(item["inputTokens"] ?? 0),
      outputTokens: Number(item["outputTokens"] ?? 0),
      requestCount: Number(item["requestCount"] ?? 0),
    });
  }
  result.members.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  return result;
}
