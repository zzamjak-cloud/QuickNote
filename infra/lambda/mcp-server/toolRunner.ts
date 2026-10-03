// 툴 실행 래퍼: 결과 직렬화·오류 매핑·감사 로그(구조화 JSON 한 줄). 내부 오류 상세는 응답에 싣지 않는다.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { ResolverError } from "../v5-resolvers/handlers/_auth";
import { ToolError, type McpContext } from "./context";

/** 감사 로그 필드 — 툴 입력에서 뽑은 id·모드·바이트 등. */
export type AuditFields = Record<string, unknown>;

function textResult(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// 재사용한 v5 핸들러의 권한·입력 거부(Forbidden·BadRequest·NotFound)는 사용자 오류로 돌려준다.
const USER_FACING_RESOLVER_ERRORS = new Set(["Forbidden", "BadRequest", "NotFound", "Unauthorized"]);

function mapError(tool: string, err: unknown): CallToolResult {
  if (err instanceof ToolError) return errorResult(err.message);
  if (err instanceof ZodError) return errorResult(`Invalid input: ${err.issues.map((i) => i.message).join(", ")}`);
  if (err instanceof ResolverError && USER_FACING_RESOLVER_ERRORS.has(err.errorType)) {
    return errorResult(`Rejected: ${err.message}`);
  }
  console.error("mcp tool 실패", tool, err);
  return errorResult("Internal error");
}

/** auditOf 는 결과에서 생성된 id 등 추가 감사 필드를 뽑는다(쓰기 툴). */
export async function runTool<T>(
  ctx: McpContext,
  tool: string,
  audit: AuditFields,
  fn: () => Promise<T>,
  auditOf?: (result: T) => AuditFields,
): Promise<CallToolResult> {
  const started = Date.now();
  let ok = false;
  let extra: AuditFields = {};
  try {
    const value = await fn();
    extra = auditOf?.(value) ?? {};
    ok = true;
    return textResult(value);
  } catch (err) {
    return mapError(tool, err);
  } finally {
    console.info(
      JSON.stringify({
        evt: "mcp.tool",
        tool,
        tokenId: ctx.token.tokenId,
        memberId: ctx.caller.memberId,
        ids: audit,
        ...extra,
        ms: Date.now() - started,
        ok,
      }),
    );
  }
}
