// MCP 서버 구성 — 읽기 툴 등록(쓰기 툴은 serverWrite.ts). 감사 로그는 toolRunner.runTool 이 남긴다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QFM_SYNTAX_GUIDE } from "../../../src/lib/docModel/markdown";
import type { McpContext } from "./context";
import { registerWriteTools } from "./serverWrite";
import { runTool } from "./toolRunner";
import { getCommentsInputShape, getCommentsTool } from "./tools/comments";
import { fetchInputShape, fetchTool } from "./tools/fetch";
import { listWorkspacesTool } from "./tools/listWorkspaces";
import { queryDatabaseInputShape, queryDatabaseTool } from "./tools/queryDatabase";
import { searchInputShape, searchTool } from "./tools/search";
import { getUsersInputShape, getUsersTool } from "./tools/users";

export const MCP_SERVER_INFO = { name: "quicknote", version: "1.0.0" };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO);

  server.registerTool(
    "list_workspaces",
    { description: "List QuickNote workspaces this token can read (id, name, type, access level).", annotations: READ_ONLY },
    async () => runTool(ctx, "list_workspaces", {}, () => listWorkspacesTool(ctx)),
  );

  server.registerTool(
    "search",
    {
      description:
        "Search QuickNote pages by title (exact > prefix > contains), then by body text of recently updated pages. " +
        "Returns id, title, workspaceId, ancestor path, type, snippet. Use fetch with a result id to read it.",
      inputSchema: searchInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "search", { workspaceId: args.workspaceId }, () => searchTool(ctx, args)),
  );

  server.registerTool(
    "fetch",
    {
      description:
        "Read a QuickNote page or database by id. Pages return a metadata header, database-row properties, " +
        "child pages and the body as QuickNote-flavored Markdown (QFM). Databases return columns, views and " +
        "the first 50 rows (use nextCursor as cursor for more).\n\n" +
        QFM_SYNTAX_GUIDE,
      inputSchema: fetchInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "fetch", { id: args.id }, () => fetchTool(ctx, args)),
  );

  server.registerTool(
    "get_users",
    {
      description: "List active QuickNote members (id, name, email). Optionally only those who can access a workspace.",
      inputSchema: getUsersInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "get_users", { workspaceId: args.workspaceId }, () => getUsersTool(ctx, args)),
  );

  server.registerTool(
    "get_comments",
    {
      description: "List block comments on a QuickNote page (threaded by blockId/parentId, oldest first).",
      inputSchema: getCommentsInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "get_comments", { pageId: args.pageId }, () => getCommentsTool(ctx, args)),
  );

  server.registerTool(
    "query_database",
    {
      description:
        "Query rows of a database with the same search/filter/sort semantics as QuickNote views. Filters use column names and " +
        "human values (option labels, member email/id, YYYY-MM-DD, true/false); operators: contains, equals, notEquals, gt, lt, " +
        "isEmpty, isNotEmpty. Returns a markdown table, row ids and nextCursor. Scans at most 5000 rows (reported as truncated).",
      inputSchema: queryDatabaseInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "query_database", { databaseId: args.databaseId }, () => queryDatabaseTool(ctx, args)),
  );

  registerWriteTools(server, ctx);
  return server;
}
