// LC 스케줄러 일정 핸들러 — workspace 권한 검사 후 DynamoDB CRUD 수행.
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

// 스케줄 레코드 형상 (DynamoDB 저장 단위)
type ScheduleRecord = {
  id: string;
  workspaceId: string;
  title: string;
  comment?: string;
  link?: string;
  projectId?: string;
  startAt: string;
  endAt: string;
  assigneeId?: string;
  color?: string;
  textColor?: string;
  rowIndex?: number;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

// 단순 ID 생성기 — 충돌 가능성 매우 낮은 timestamp+random 조합
function genId(): string {
  return `sch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function listSchedules(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  from: string;
  to: string;
}): Promise<ScheduleRecord[]> {
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
      TableName: args.tables.Schedules!,
      IndexName: "byWorkspaceAndStartAt",
      KeyConditionExpression: "workspaceId = :w AND startAt BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":w": args.workspaceId,
        ":from": args.from,
        ":to": args.to,
      },
    }),
  );
  return (r.Items ?? []) as ScheduleRecord[];
}

export async function createSchedule(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    workspaceId: string;
    title: string;
    comment?: string | null;
    link?: string | null;
    projectId?: string | null;
    startAt: string;
    endAt: string;
    assigneeId?: string | null;
    color?: string | null;
    textColor?: string | null;
    rowIndex?: number | null;
  };
}): Promise<ScheduleRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  const now = new Date().toISOString();
  const item: ScheduleRecord = {
    id: genId(),
    workspaceId: args.input.workspaceId,
    title: args.input.title,
    startAt: args.input.startAt,
    endAt: args.input.endAt,
    ...(args.input.assigneeId ? { assigneeId: args.input.assigneeId } : {}),
    ...(args.input.color ? { color: args.input.color } : {}),
    ...(args.input.comment ? { comment: args.input.comment } : {}),
    ...(args.input.link ? { link: args.input.link } : {}),
    ...(args.input.projectId ? { projectId: args.input.projectId } : {}),
    ...(args.input.textColor ? { textColor: args.input.textColor } : {}),
    ...(typeof args.input.rowIndex === "number" ? { rowIndex: args.input.rowIndex } : {}),
    createdByMemberId: args.caller.memberId,
    createdAt: now,
    updatedAt: now,
  };

  await args.doc.send(new PutCommand({ TableName: args.tables.Schedules!, Item: item }));
  return item;
}

export async function updateSchedule(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: {
    id: string;
    workspaceId: string;
    title?: string | null;
    comment?: string | null;
    link?: string | null;
    projectId?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    assigneeId?: string | null;
    color?: string | null;
    textColor?: string | null;
    rowIndex?: number | null;
  };
}): Promise<ScheduleRecord> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });

  // DynamoDB 예약어 회피용 alias (comment, name 등)
  const names: Record<string, string> = {};
  const updates: string[] = ["updatedAt = :t"];
  const vals: Record<string, unknown> = {
    ":t": new Date().toISOString(),
    ":workspaceId": args.input.workspaceId,
  };

  if (args.input.title != null) { updates.push("title = :ti"); vals[":ti"] = args.input.title; }
  if (args.input.startAt != null) { updates.push("startAt = :s"); vals[":s"] = args.input.startAt; }
  if (args.input.endAt != null) { updates.push("endAt = :e"); vals[":e"] = args.input.endAt; }
  if (args.input.assigneeId != null) { updates.push("assigneeId = :a"); vals[":a"] = args.input.assigneeId; }
  if (args.input.color != null) { updates.push("color = :c"); vals[":c"] = args.input.color; }
  if (args.input.comment != null) {
    names["#cm"] = "comment";
    updates.push("#cm = :cm");
    vals[":cm"] = args.input.comment;
  }
  if (args.input.link != null) { updates.push("link = :lk"); vals[":lk"] = args.input.link; }
  if (args.input.projectId != null) { updates.push("projectId = :p"); vals[":p"] = args.input.projectId; }
  if (args.input.textColor != null) { updates.push("textColor = :tc"); vals[":tc"] = args.input.textColor; }
  if (typeof args.input.rowIndex === "number") { updates.push("rowIndex = :ri"); vals[":ri"] = args.input.rowIndex; }

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Schedules!,
      Key: { id: args.input.id },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ConditionExpression: "#workspaceId = :workspaceId",
      ExpressionAttributeValues: vals,
      ExpressionAttributeNames: {
        ...(Object.keys(names).length ? names : {}),
        "#workspaceId": "workspaceId",
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return r.Attributes as ScheduleRecord;
}

export async function deleteSchedule(args: {
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
      TableName: args.tables.Schedules!,
      Key: { id: args.id },
      ConditionExpression: "#workspaceId = :workspaceId",
      ExpressionAttributeNames: {
        "#workspaceId": "workspaceId",
      },
      ExpressionAttributeValues: {
        ":workspaceId": args.workspaceId,
      },
    }),
  );
  return true;
}
