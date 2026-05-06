import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Member, Tables } from "./member";

export type MemberMini = {
  memberId: string;
  name: string;
  jobRole: string;
};

export async function searchMembersForMention(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  query?: string | null;
  limit?: number | null;
}): Promise<MemberMini[]> {
  const rawQuery = (args.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  const r = await args.doc.send(new ScanCommand({ TableName: args.tables.Members }));
  const members = (r.Items ?? []) as Member[];
  const matched = members
    .filter((m) => m.status === "active")
    .filter((m) => {
      if (!rawQuery) return true;
      return (
        m.name.toLowerCase().includes(rawQuery) ||
        m.jobRole.toLowerCase().includes(rawQuery)
      );
    })
    .slice(0, limit)
    .map((m) => ({ memberId: m.memberId, name: m.name, jobRole: m.jobRole }));
  return matched;
}
