// 워크스페이스 공유 커스텀 아이콘.
// - listCustomIcons : 워크스페이스의 모든 아이콘 (최신순)
// - createCustomIcon : 새 아이콘 추가 — 워크스페이스 멤버라면 모두 가능
// - deleteCustomIcon : 아이콘 제거 — 워크스페이스 멤버라면 모두 가능 (삭제된 row 반환)

import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { Tables } from "./member";
import type { Member } from "./_auth";
import { badRequest, forbidden, notFound, requireWorkspaceAccess } from "./_auth";
import { syncCustomIconAssetUsage, removeCustomIconAssetUsage } from "./asset";

function requireTable(name: string | undefined, label: string): string {
  if (!name) throw new Error(`${label} 환경 변수 미설정`);
  return name;
}

export type CustomIcon = {
  id: string;
  workspaceId: string;
  src: string;
  label: string;
  createdAt: string;
  createdByMemberId?: string | null;
};

export async function listCustomIcons(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<CustomIcon[]> {
  const table = requireTable(args.tables.CustomIcons, "CUSTOM_ICONS_TABLE_NAME");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const out: CustomIcon[] = [];
  let startKey: Record<string, unknown> | undefined = undefined;
  do {
    const res = await args.doc.send(
      new QueryCommand({
        TableName: table,
        IndexName: "byWorkspaceAndCreatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
        ScanIndexForward: false, // 최신순
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of (res.Items ?? []) as CustomIcon[]) out.push(it);
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

export async function createCustomIcon(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { workspaceId: string; src: string; label: string };
}): Promise<CustomIcon> {
  if (!args.input?.workspaceId || !args.input?.src) {
    throw badRequest("workspaceId/src 필수");
  }
  const table = requireTable(args.tables.CustomIcons, "CUSTOM_ICONS_TABLE_NAME");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });
  const item: CustomIcon = {
    id: randomUUID(),
    workspaceId: args.input.workspaceId,
    src: args.input.src,
    label: args.input.label ?? "",
    createdAt: new Date().toISOString(),
    createdByMemberId: args.caller.memberId,
  };
  await args.doc.send(new PutCommand({ TableName: table, Item: item }));
  // 자산 사용 인덱스에 라이브러리 등록을 기록 — 어떤 페이지에서도 쓰이지 않더라도
  // "미사용" 으로 잘못 분류돼 일괄 삭제되는 회귀 방지. 실패는 무시(인덱스는 보조 데이터).
  if (args.caller.cognitoSub) {
    try {
      await syncCustomIconAssetUsage({
        doc: args.doc,
        tables: args.tables,
        ownerId: args.caller.cognitoSub,
        workspaceId: item.workspaceId,
        iconId: item.id,
        iconLabel: item.label ?? null,
        src: item.src,
      });
    } catch (err) {
      console.error("[createCustomIcon] AssetUsage sync 실패 (무시)", err);
    }
  }
  return item;
}

export async function deleteCustomIcon(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<CustomIcon> {
  const table = requireTable(args.tables.CustomIcons, "CUSTOM_ICONS_TABLE_NAME");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: table, Key: { id: args.id } }),
  );
  const item = existing.Item as CustomIcon | undefined;
  if (!item) throw notFound("커스텀 아이콘 없음");
  if (item.workspaceId !== args.workspaceId) {
    throw forbidden("다른 워크스페이스의 아이콘은 삭제할 수 없습니다");
  }
  await args.doc.send(
    new DeleteCommand({
      TableName: table,
      Key: { id: args.id },
      ConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );
  // 자산 사용 인덱스에서 라이브러리 row 제거 — 자산이 어디서도 안 쓰이면 이후 정리 대상이 된다.
  try {
    await removeCustomIconAssetUsage({
      doc: args.doc,
      tables: args.tables,
      iconId: item.id,
      src: item.src,
    });
  } catch (err) {
    console.error("[deleteCustomIcon] AssetUsage 제거 실패 (무시)", err);
  }
  return item;
}
