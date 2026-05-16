// LC 스케줄러 공휴일 핸들러 — workspace 권한 검사 후 DynamoDB CRUD 수행.
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

// 공휴일 레코드 형상 (DynamoDB 저장 단위)
type HolidayRecord = {
  id: string;
  workspaceId: string;
  title: string;
  date: string;
  type: string;
  color: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

// ID 생성기
function genId(): string {
  return `hol_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function listHolidays(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<HolidayRecord[]> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });

  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Holidays!,
      IndexName: "byWorkspace",
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );
  return (r.Items ?? []) as HolidayRecord[];
}

export async function createHoliday(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    workspaceId: string;
    title: string;
    date: string;
    type: string;
    color: string;
  };
}): Promise<HolidayRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  const now = new Date().toISOString();
  const item: HolidayRecord = {
    id: genId(),
    workspaceId: args.input.workspaceId,
    title: args.input.title,
    date: args.input.date,
    type: args.input.type,
    color: args.input.color,
    createdByMemberId: args.caller.memberId,
    createdAt: now,
    updatedAt: now,
  };

  await args.doc.send(new PutCommand({ TableName: args.tables.Holidays!, Item: item }));
  return item;
}

export async function updateHoliday(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    id: string;
    workspaceId: string;
    title?: string | null;
    date?: string | null;
    type?: string | null;
    color?: string | null;
  };
}): Promise<HolidayRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  // DynamoDB 예약어 회피: date → #dt, type → #tp, title → #ti
  const names: Record<string, string> = {};
  const updates: string[] = ["updatedAt = :t"];
  const vals: Record<string, unknown> = { ":t": new Date().toISOString() };

  if (args.input.title != null) {
    names["#ti"] = "title";
    updates.push("#ti = :ti");
    vals[":ti"] = args.input.title;
  }
  if (args.input.date != null) {
    names["#dt"] = "date";
    updates.push("#dt = :dt");
    vals[":dt"] = args.input.date;
  }
  if (args.input.type != null) {
    names["#tp"] = "type";
    updates.push("#tp = :tp");
    vals[":tp"] = args.input.type;
  }
  if (args.input.color != null) { updates.push("color = :c"); vals[":c"] = args.input.color; }

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Holidays!,
      Key: { id: args.input.id, workspaceId: args.input.workspaceId },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeValues: vals,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as HolidayRecord;
}

export async function deleteHoliday(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });

  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Holidays!,
      Key: { id: args.id, workspaceId: args.workspaceId },
    }),
  );
  return true;
}
