// 콘텐츠 확장 툴 등록 — DB 뷰·필터 탭, 웹 게시, 플로우차트, 댓글 수정·삭제·리액션, 페이지 표지·제목 색, 이미지 업로드.
// 쓰기 툴은 beginWrite(write scope·일일 상한) 후 각 툴이 워크스페이스 edit·MCP 정책을 검사한다. 감사 로그는 runTool.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { runTool } from "./toolRunner";
import { beginWrite } from "./writeAccess";
import { setPageAppearanceInputShape, setPageAppearanceTool } from "./tools/content/appearance";
import {
  deleteCommentInputShape, deleteCommentTool,
  toggleCommentReactionInputShape, toggleCommentReactionTool,
  updateCommentInputShape, updateCommentTool,
} from "./tools/content/comments";
import {
  getFlowchartInputShape, getFlowchartTool,
  listFlowchartHistoryInputShape, listFlowchartHistoryTool,
  listFlowchartsInputShape, listFlowchartsTool,
  saveFlowchartInputShape, saveFlowchartTool,
} from "./tools/content/flowchart";
import { uploadImageInputShape, uploadImageTool } from "./tools/content/imageUpload";
import {
  getPublishStatusInputShape, getPublishStatusTool,
  publishPageInputShape, publishPageTool,
  unpublishPageInputShape, unpublishPageTool,
} from "./tools/content/publish";
import {
  deleteFilterPresetInputShape, deleteFilterPresetTool,
  listDatabaseViewsInputShape, listDatabaseViewsTool,
  saveFilterPresetInputShape, saveFilterPresetTool,
  updateDatabaseViewInputShape, updateDatabaseViewTool,
} from "./tools/content/views";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

const WRITE_NOTE = "Requires a token with write scope and edit access to the workspace.";

function gated<T>(ctx: McpContext, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    await beginWrite(ctx, 1);
    return fn();
  };
}

function registerViewTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_database_views",
    {
      description:
        "Show how a database is displayed: the full-page view (and the inline view on pageId, if given) with layout, filters, sorts, " +
        "grouping, per-layout column order/hidden columns and filter tabs, plus database-level settings.",
      inputSchema: listDatabaseViewsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_database_views", { databaseId: args.databaseId, pageId: args.pageId }, () => listDatabaseViewsTool(ctx, args)),
  );

  server.registerTool(
    "update_database_view",
    {
      description:
        "Change one database view: layout (table/kanban/timeline/gallery/list), filters (same human values as query_database), sorts, search, " +
        "grouping, board/timeline/gallery columns, per-layout column order and hidden columns, hidden layouts, active filter tab. " +
        `Targets the inline view on pageId, else the full-page view. Open editors update live. ${WRITE_NOTE}`,
      inputSchema: updateDatabaseViewInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "update_database_view", { databaseId: args.databaseId, pageId: args.pageId }, gated(ctx, () => updateDatabaseViewTool(ctx, args))),
  );

  server.registerTool(
    "save_database_filter_preset",
    {
      description: `Create or update a filter tab (name, icon, filters, sorts) on a database view and activate it by default. ${WRITE_NOTE}`,
      inputSchema: saveFilterPresetInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "save_database_filter_preset", { databaseId: args.databaseId, pageId: args.pageId }, gated(ctx, () => saveFilterPresetTool(ctx, args))),
  );

  server.registerTool(
    "delete_database_filter_preset",
    {
      description: `Remove a filter tab from a database view (rows are not affected). ${WRITE_NOTE}`,
      inputSchema: deleteFilterPresetInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "delete_database_filter_preset", { databaseId: args.databaseId, pageId: args.pageId }, gated(ctx, () => deleteFilterPresetTool(ctx, args))),
  );
}

function registerPublishTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "publish_page",
    {
      description:
        "Publish a page (with its child pages) to the web and return its public URL. Already published pages keep their URL and the " +
        `public snapshot is refreshed with the latest content. Anyone with the URL can read it. ${WRITE_NOTE}`,
      inputSchema: publishPageInputShape,
      annotations: { ...WRITE, openWorldHint: true },
    },
    async (args) => runTool(ctx, "publish_page", { pageIds: [args.pageId] }, gated(ctx, () => publishPageTool(ctx, args))),
  );

  server.registerTool(
    "unpublish_page",
    {
      description: `Stop publishing a page: every public URL for it stops working (republishing issues a new URL). ${WRITE_NOTE}`,
      inputSchema: unpublishPageInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) => runTool(ctx, "unpublish_page", { pageIds: [args.pageId] }, gated(ctx, () => unpublishPageTool(ctx, args))),
  );

  server.registerTool(
    "get_publish_status",
    {
      description: "Whether a page is published to the web, with its public URL and publish time.",
      inputSchema: getPublishStatusInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "get_publish_status", { pageIds: [args.pageId] }, () => getPublishStatusTool(ctx, args)),
  );
}

function registerFlowchartTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_flowcharts",
    {
      description: "List flowcharts of a workspace (id, title, node/edge counts). A page shows one as <qn-block id=\"<flowchartId>\" type=\"flowchartBlock\"/>.",
      inputSchema: listFlowchartsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_flowcharts", { workspaceId: args.workspaceId }, () => listFlowchartsTool(ctx, args)),
  );

  server.registerTool(
    "get_flowchart",
    {
      description: "Read a flowchart: shapes (id, label, shape, x, y, size, color, link) and arrows (from, to, sides, label, color).",
      inputSchema: getFlowchartInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "get_flowchart", { flowchartId: args.flowchartId }, () => getFlowchartTool(ctx, args)),
  );

  server.registerTool(
    "save_flowchart",
    {
      description:
        "Create a flowchart or replace an existing one's shapes and arrows (all pages sharing it show the new chart when reopened). " +
        "Saves a version snapshot like the app. Optionally inserts a block for it at the end of a page. Shapes: rectangle, roundRectangle, " +
        `terminator, ellipse, diamond, parallelogram, hexagon, cylinder, document, text. ${WRITE_NOTE}`,
      inputSchema: saveFlowchartInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "save_flowchart", { flowchartId: args.flowchartId, workspaceId: args.workspaceId }, gated(ctx, () => saveFlowchartTool(ctx, args)),
        (r) => ({ flowchartId: r.flowchartId })),
  );

  server.registerTool(
    "list_flowchart_history",
    {
      description: "List saved versions of a flowchart (newest first) with node/edge counts.",
      inputSchema: listFlowchartHistoryInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_flowchart_history", { flowchartId: args.flowchartId }, () => listFlowchartHistoryTool(ctx, args)),
  );
}

function registerCommentAndPageTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "update_comment",
    {
      description: `Edit the text of your own comment (id from get_comments). ${WRITE_NOTE}`,
      inputSchema: updateCommentInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "update_comment", { commentId: args.commentId }, gated(ctx, () => updateCommentTool(ctx, args))),
  );

  server.registerTool(
    "delete_comment",
    {
      description: `Delete your own comment. ${WRITE_NOTE}`,
      inputSchema: deleteCommentInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) => runTool(ctx, "delete_comment", { commentId: args.commentId }, gated(ctx, () => deleteCommentTool(ctx, args))),
  );

  server.registerTool(
    "toggle_comment_reaction",
    {
      description: `Add or remove your emoji reaction on a comment (toggles when reacted is omitted). ${WRITE_NOTE}`,
      inputSchema: toggleCommentReactionInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "toggle_comment_reaction", { commentId: args.commentId }, gated(ctx, () => toggleCommentReactionTool(ctx, args))),
  );

  server.registerTool(
    "set_page_appearance",
    {
      description: `Set or remove a page's cover image (upload_image ref or https URL) and title color. Use update_page for title and icon. ${WRITE_NOTE}`,
      inputSchema: setPageAppearanceInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "set_page_appearance", { pageIds: [args.pageId] }, gated(ctx, () => setPageAppearanceTool(ctx, args))),
  );

  server.registerTool(
    "upload_image",
    {
      description:
        "Upload an image (PNG/JPEG/GIF/WebP) from a public URL or base64 data to QuickNote's asset store. Returns a quicknote-image:// ref " +
        `and a markdown line to put in page content (create_pages / update_page) or use as a cover (set_page_appearance). ${WRITE_NOTE}`,
      inputSchema: uploadImageInputShape,
      annotations: { ...WRITE, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "upload_image", { workspaceId: args.workspaceId, source: args.url ? "url" : "data" }, gated(ctx, () => uploadImageTool(ctx, args)),
        (r) => ({ assetId: r.assetId, bytes: r.size })),
  );
}

export function registerContentTools(server: McpServer, ctx: McpContext): void {
  registerViewTools(server, ctx);
  registerPublishTools(server, ctx);
  registerFlowchartTools(server, ctx);
  registerCommentAndPageTools(server, ctx);
}
