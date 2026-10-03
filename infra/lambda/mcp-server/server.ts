// MCP 서버 구성 — 읽기 툴 등록 + 툴 호출별 감사 로그(구조화 JSON 한 줄).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { QFM_SYNTAX_GUIDE } from "../../../src/lib/docModel/markdown";
import { ToolError, type McpContext } from "./context";
import { getCommentsInputShape, getCommentsTool } from "./tools/comments";
import { fetchInputShape, fetchTool } from "./tools/fetch";
import { listWorkspacesTool } from "./tools/listWorkspaces";
import { searchInputShape, searchTool } from "./tools/search";
import { getUsersInputShape, getUsersTool } from "./tools/users";

export const MCP_SERVER_INFO = { name: "quicknote", version: "1.0.0" };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function textResult(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** 툴 실행 래퍼: 결과 직렬화·오류 매핑·감사 로그. 내부 오류 상세는 응답에 싣지 않는다. */
async function runTool(
  ctx: McpContext,
  tool: string,
  ids: Record<string, unknown>,
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  const started = Date.now();
  let ok = false;
  try {
    const result = textResult(await fn());
    ok = true;
    return result;
  } catch (err) {
    if (err instanceof ToolError) return errorResult(err.message);
    if (err instanceof ZodError) return errorResult(`Invalid input: ${err.issues.map((i) => i.message).join(", ")}`);
    console.error("mcp tool 실패", tool, err);
    return errorResult("Internal error");
  } finally {
    console.info(
      JSON.stringify({
        evt: "mcp.tool",
        tool,
        tokenId: ctx.token.tokenId,
        memberId: ctx.caller.memberId,
        ids,
        ms: Date.now() - started,
        ok,
      }),
    );
  }
}

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

  return server;
}
