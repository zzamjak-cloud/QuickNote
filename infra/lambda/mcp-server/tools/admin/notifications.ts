// 알림 — 토큰 소유 멤버의 알림 목록·읽음·삭제(v5 notification 핸들러 재사용).
// 토큰 workspaceIds 범위 밖 워크스페이스의 알림은 목록에서 빼고, 읽음·삭제도 없는 것처럼 거부한다.
import { z } from "zod";
import {
  deleteMyNotification,
  listMyNotifications,
  markNotificationRead,
} from "../../../v5-resolvers/handlers/notification";
import { NOT_ACCESSIBLE } from "../../access";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { requireWriteScope } from "../../writeAccess";
import { filterVisible, workspaceVisibility } from "./shared";

type Item = Record<string, unknown>;

const notificationIdInput = z.string().trim().min(1).max(256);
const notificationIdsInput = z.array(notificationIdInput).min(1).max(100);

function notificationView(n: Item): Item {
  return {
    notificationId: n.notificationId,
    kind: n.kind ?? null,
    source: n.source ?? null,
    read: n.read === true,
    createdAt: n.createdAt ?? null,
    workspaceId: n.workspaceId ?? null,
    pageId: n.pageId ?? null,
    blockId: n.blockId ?? null,
    commentId: n.commentId ?? null,
    fromMemberId: n.fromMemberId ?? null,
    preview: n.previewBody ?? "",
  };
}

async function visibleNotifications(ctx: McpContext): Promise<Item[]> {
  const all = await listMyNotifications({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller });
  return filterVisible(all, (n) => n.workspaceId, workspaceVisibility(ctx));
}

export const listNotificationsInputShape = {
  unreadOnly: z.boolean().optional().describe("Only unread notifications (default false)"),
  limit: z.number().int().min(1).max(200).optional().describe("Max notifications (default 50, newest first)"),
};
const listNotificationsInput = z.object(listNotificationsInputShape);

export async function listNotificationsTool(ctx: McpContext, raw: z.input<typeof listNotificationsInput>) {
  const input = listNotificationsInput.parse(raw);
  const visible = await visibleNotifications(ctx);
  const filtered = input.unreadOnly ? visible.filter((n) => n.read !== true) : visible;
  return {
    unreadCount: visible.filter((n) => n.read !== true).length,
    notifications: filtered.slice(0, input.limit ?? 50).map(notificationView),
  };
}

/** 본인 알림 중 토큰 범위 안의 것만. 없음·범위 밖은 같은 문구로 숨긴다(UpdateItem 이 없는 키를 만들지 않게 먼저 확인). */
async function loadOwnNotifications(ctx: McpContext, ids: string[]): Promise<Item[]> {
  const visible = workspaceVisibility(ctx);
  const out: Item[] = [];
  for (const notificationId of Array.from(new Set(ids))) {
    const n = await getItem(ctx.doc, ctx.tables.Notifications, { recipientMemberId: ctx.caller.memberId, notificationId });
    if (!n || !(await visible(n.workspaceId))) throw new ToolError(NOT_ACCESSIBLE);
    out.push(n);
  }
  return out;
}

export const markNotificationReadInputShape = {
  notificationIds: notificationIdsInput.optional().describe("Notification ids from list_notifications"),
  all: z.boolean().optional().describe("Mark every unread notification visible to this token as read"),
};
const markNotificationReadInput = z.object(markNotificationReadInputShape);

export async function markNotificationReadTool(ctx: McpContext, raw: z.input<typeof markNotificationReadInput>) {
  const input = markNotificationReadInput.parse(raw);
  requireWriteScope(ctx);
  if (input.all === true && input.notificationIds) throw new ToolError("Pass either notificationIds or all: true, not both");
  let targets: Item[];
  if (input.all === true) targets = (await visibleNotifications(ctx)).filter((n) => n.read !== true);
  else if (input.notificationIds) targets = await loadOwnNotifications(ctx, input.notificationIds);
  else throw new ToolError("Pass notificationIds or all: true");
  for (const n of targets) {
    await markNotificationRead({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, notificationId: String(n.notificationId) });
  }
  return { markedRead: targets.map((n) => n.notificationId) };
}

export const deleteNotificationInputShape = {
  notificationIds: notificationIdsInput.describe("Notification ids from list_notifications"),
};
const deleteNotificationInput = z.object(deleteNotificationInputShape);

export async function deleteNotificationTool(ctx: McpContext, raw: z.input<typeof deleteNotificationInput>) {
  const input = deleteNotificationInput.parse(raw);
  requireWriteScope(ctx);
  const targets = await loadOwnNotifications(ctx, input.notificationIds);
  for (const n of targets) {
    await deleteMyNotification({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, notificationId: String(n.notificationId) });
  }
  return { deleted: targets.map((n) => n.notificationId) };
}
