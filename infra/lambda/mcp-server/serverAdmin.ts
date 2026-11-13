// 관리 툴 등록 — 알림, 워크스페이스 생성·수정(삭제·보관 없음), 즐겨찾기, 커스텀 아이콘, 자산 목록·사용처.
// 쓰기 툴은 beginWrite(write scope·일일 상한) 후 각 툴이 워크스페이스·소유 검사를 한다. 감사 로그는 runTool.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { runTool } from "./toolRunner";
import { beginWrite } from "./writeAccess";
import {
  createCustomIconInputShape, createCustomIconTool,
  getAssetUsagesInputShape, getAssetUsagesTool,
  listCustomIconsInputShape, listCustomIconsTool,
  listMyAssetsInputShape, listMyAssetsTool,
} from "./tools/admin/assets";
import {
  addFavoriteInputShape, addFavoriteTool,
  listFavoritesTool,
  removeFavoriteInputShape, removeFavoriteTool,
} from "./tools/admin/favorites";
import {
  deleteNotificationInputShape, deleteNotificationTool,
  listNotificationsInputShape, listNotificationsTool,
  markNotificationReadInputShape, markNotificationReadTool,
} from "./tools/admin/notifications";
import {
  createWorkspaceInputShape, createWorkspaceTool,
  updateWorkspaceInputShape, updateWorkspaceTool,
} from "./tools/admin/workspaces";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

const WRITE_NOTE = "Requires a token with write scope.";

function gated<T>(ctx: McpContext, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    await beginWrite(ctx, 1);
    return fn();
  };
}

function registerNotificationTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_notifications",
    {
      description: "List the token owner's notifications (mentions, thread replies; newest first) with unreadCount.",
      inputSchema: listNotificationsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_notifications", {}, () => listNotificationsTool(ctx, args)),
  );

  server.registerTool(
    "mark_notification_read",
    {
      description: `Mark the token owner's notifications as read (by notificationIds, or all: true). ${WRITE_NOTE}`,
      inputSchema: markNotificationReadInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "mark_notification_read", { all: args.all === true }, gated(ctx, () => markNotificationReadTool(ctx, args)), (r) => ({ count: r.markedRead.length })),
  );

  server.registerTool(
    "delete_notification",
    {
      description: `Delete the token owner's notifications. ${WRITE_NOTE}`,
      inputSchema: deleteNotificationInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "delete_notification", { notificationIds: args.notificationIds }, gated(ctx, () => deleteNotificationTool(ctx, args))),
  );
}

function registerWorkspaceTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "create_workspace",
    {
      description:
        "Create a shared workspace (manager role or above). The token owner gets edit access; add more with access. " +
        `Tokens limited to specific workspaces cannot create workspaces. ${WRITE_NOTE}`,
      inputSchema: createWorkspaceInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "create_workspace", {}, gated(ctx, () => createWorkspaceTool(ctx, args)), (r) => ({ workspaceId: r.workspaceId })),
  );

  server.registerTool(
    "update_workspace",
    {
      description: `Rename a workspace or replace its job-function/job-title option lists (manager role or above, edit access). ${WRITE_NOTE}`,
      inputSchema: updateWorkspaceInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "update_workspace", { workspaceId: args.workspaceId }, gated(ctx, () => updateWorkspaceTool(ctx, args))),
  );
}

function registerFavoriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_favorites",
    { description: "List the token owner's favorite pages in sidebar order (id, title, icon, workspaceId).", annotations: READ_ONLY },
    async () => runTool(ctx, "list_favorites", {}, () => listFavoritesTool(ctx)),
  );

  server.registerTool(
    "add_favorite",
    {
      description: `Add a page to the token owner's favorites (end of the list). Apps pick it up on their next sync. ${WRITE_NOTE}`,
      inputSchema: addFavoriteInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "add_favorite", { pageIds: [args.pageId] }, gated(ctx, () => addFavoriteTool(ctx, args))),
  );

  server.registerTool(
    "remove_favorite",
    {
      description: `Remove a page from the token owner's favorites. ${WRITE_NOTE}`,
      inputSchema: removeFavoriteInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "remove_favorite", { pageIds: [args.pageId] }, gated(ctx, () => removeFavoriteTool(ctx, args))),
  );
}

function registerAssetTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_my_assets",
    {
      description: "List images/files the token owner uploaded (ref, name, MIME type, size, usage count). Paginate with cursor. " +
        "With a token limited to specific workspaces, only assets used in those workspaces are listed (unused assets are hidden; pages may be shorter than limit).",
      inputSchema: listMyAssetsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_my_assets", {}, () => listMyAssetsTool(ctx, args)),
  );

  server.registerTool(
    "get_asset_usages",
    {
      description: "List where one of the token owner's assets is used (page, block, custom icon) in workspaces this token can read.",
      inputSchema: getAssetUsagesInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "get_asset_usages", { assetId: args.assetId }, () => getAssetUsagesTool(ctx, args)),
  );

  server.registerTool(
    "list_custom_icons",
    {
      description: "List a workspace's shared custom icons (src usable as a page icon).",
      inputSchema: listCustomIconsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_custom_icons", { workspaceId: args.workspaceId }, () => listCustomIconsTool(ctx, args)),
  );

  server.registerTool(
    "create_custom_icon",
    {
      description:
        "Add a shared custom icon to a workspace from an image the token owner already uploaded (src quicknote-image://<assetId>, " +
        `see list_my_assets). Requires edit access to the workspace. ${WRITE_NOTE}`,
      inputSchema: createCustomIconInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "create_custom_icon", { workspaceId: args.workspaceId }, gated(ctx, () => createCustomIconTool(ctx, args)), (r) => ({ iconId: r.id })),
  );
}

export function registerAdminTools(server: McpServer, ctx: McpContext): void {
  registerNotificationTools(server, ctx);
  registerWorkspaceTools(server, ctx);
  registerFavoriteTools(server, ctx);
  registerAssetTools(server, ctx);
}
