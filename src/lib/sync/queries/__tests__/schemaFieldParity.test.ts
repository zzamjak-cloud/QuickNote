// 클라이언트 쿼리가 요청하는 필드가 AppSync 스키마 타입에 없으면 해당 쿼리 전체가
// FieldUndefined 검증 에러로 거절된다(2026-06-11 PageMeta lastEditedBy* 누락 사고).
// 쿼리 필드 ⊆ 스키마 타입 필드 정합성을 빌드 시점에 강제한다.
//
// 4.4 확장: 2개 쿼리 하드코딩 → items 셀렉션을 가진 모든 list 쿼리를 SDL 기반으로
// 자동 해소해 전수 검사한다. + Page 스칼라 타입의 알려진 표류(order: number↔String)를 명시 고정.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as pageQueries from "../page";
import * as databaseQueries from "../database";
import * as commentQueries from "../comment";
import * as assetQueries from "../asset";
import * as pageHistoryQueries from "../pageHistory";
import * as mcpQueries from "../mcp";
import * as workspaceQueries from "../workspace";

const schemaPath = resolve(__dirname, "../../../../../infra/lib/sync/schema.graphql");
const schemaSdl = readFileSync(schemaPath, "utf-8");

/** SDL 에서 type <name> { ... } 블록 본문을 추출한다. */
function schemaTypeBody(typeName: string): string {
  const match = schemaSdl.match(
    new RegExp(`type ${typeName}[^{]*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`schema.graphql 에 type ${typeName} 없음`);
  return match[1];
}

/** SDL type 블록의 필드명 집합. */
function schemaTypeFields(typeName: string): Set<string> {
  const fields = new Set<string>();
  for (const line of schemaTypeBody(typeName).split("\n")) {
    const fieldMatch = line.trim().match(/^(\w+)\s*(\(|:)/);
    if (fieldMatch) fields.add(fieldMatch[1]);
  }
  return fields;
}

/** SDL type 블록의 필드명 → 타입(스칼라, !/[] 제거) 맵. */
function schemaTypeFieldTypes(typeName: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of schemaTypeBody(typeName).split("\n")) {
    const m = line.trim().match(/^(\w+)\s*:\s*(.+)$/);
    if (m) map.set(m[1], m[2].replace(/[[\]!]/g, "").trim());
  }
  return map;
}

/** SDL Query 필드의 반환 타입(!/[] 제거). */
function queryReturnType(opName: string): string {
  for (const line of schemaTypeBody("Query").split("\n")) {
    const m = line.trim().match(new RegExp(`^${opName}(?:\\([^)]*\\))?\\s*:\\s*(.+)$`));
    if (m) return m[1].replace(/[[\]!]/g, "").trim();
  }
  throw new Error(`schema.graphql 의 Query 에 ${opName} 없음`);
}

/** *Connection 타입의 items 요소 타입을 해소. */
function connectionItemType(connName: string): string {
  const m = schemaTypeBody(connName).match(/items\s*:\s*\[(\w+)/);
  if (!m) throw new Error(`${connName} 에 items 필드 없음`);
  return m[1];
}

/** 쿼리 문자열에서 operation 필드명을 추출(query Name(...) { <op> ... }). */
function operationName(query: string): string {
  const m = query.match(/query\s+\w+\s*(?:\([^)]*\))?\s*\{\s*(\w+)/);
  if (!m) throw new Error("쿼리에서 operation 필드명을 찾지 못함");
  return m[1];
}

/** 쿼리의 items { ... } 선택 집합에서 요청 필드명을 추출. */
function requestedItemFields(query: string): string[] {
  const match = query.match(/items \{([^}]*)\}/);
  if (!match) throw new Error("쿼리에서 items 선택 집합을 찾지 못함");
  return match[1].split(/\s+/).filter(Boolean);
}

/** operation 의 items 요소 타입을 SDL 에서 해소. */
function resolveItemType(query: string): string {
  const ret = queryReturnType(operationName(query));
  if (ret.endsWith("Connection")) return connectionItemType(ret);
  // items { } 를 쓰는데 Connection 이 아니면 스키마/쿼리 불일치 — 명시적으로 실패시킨다.
  throw new Error(`${operationName(query)} 반환 ${ret} 가 Connection 이 아닌데 items 셀렉션 사용`);
}

/** 각 쿼리 모듈에서 items 셀렉션을 가진 list 쿼리 상수를 수집. */
function collectItemQueries(): Array<{ name: string; query: string }> {
  const modules: Record<string, unknown>[] = [
    pageQueries,
    databaseQueries,
    commentQueries,
    assetQueries,
    pageHistoryQueries,
  ];
  const out: Array<{ name: string; query: string }> = [];
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "string" && value.includes("query ") && value.includes("items {")) {
        out.push({ name, query: value });
      }
    }
  }
  return out;
}

describe("클라이언트 list 쿼리 필드 ↔ schema.graphql 타입 정합성 (전수)", () => {
  const queries = collectItemQueries();

  it("items 셀렉션 쿼리를 1건 이상 수집한다", () => {
    expect(queries.length).toBeGreaterThan(0);
  });

  it.each(queries)("$name 의 모든 요청 필드는 해당 SDL 타입에 존재한다", ({ query }) => {
    const itemType = resolveItemType(query);
    const schemaFields = schemaTypeFields(itemType);
    const missing = requestedItemFields(query).filter((f) => !schemaFields.has(f));
    expect(missing).toEqual([]);
  });
});

describe("Page 스칼라 타입 ↔ SDL 정합 (알려진 표류 allowlist)", () => {
  // 클라이언트 저장 타입(types/page.ts)과 SDL Page 스칼라의 알려진 정합/표류를 고정한다.
  // SDL 타입이 바뀌면 이 테스트가 깨져 의도적 검토를 강제한다.
  const PAGE_SCALAR_EXPECTATIONS: Record<string, { sdl: string; drift?: string }> = {
    // order 는 클라이언트 number ↔ SDL String 의 의도적 표류.
    // gqlOrderNumber()/String(p.order) 로 양방향 변환한다(byDatabaseAndOrder GSI sort key).
    order: { sdl: "String", drift: "client number ↔ SDL String (변환 경유)" },
    workspaceId: { sdl: "ID" },
    title: { sdl: "String" },
    createdAt: { sdl: "AWSDateTime" },
    updatedAt: { sdl: "AWSDateTime" },
    doc: { sdl: "AWSJSON" },
    dbCells: { sdl: "AWSJSON" },
    blockComments: { sdl: "AWSJSON" },
  };

  const sdlTypes = schemaTypeFieldTypes("Page");

  it.each(Object.entries(PAGE_SCALAR_EXPECTATIONS))(
    "Page.%s 의 SDL 타입이 기대값과 일치",
    (field, { sdl }) => {
      expect(sdlTypes.get(field)).toBe(sdl);
    },
  );
});

// MCP 토큰 쿼리는 items 셀렉션이 없는 단일 객체 반환이라 위 전수 검사에서 빠진다(2026-10-03 kind 누락으로 발급 실패).
describe("MCP 토큰 쿼리 ↔ 스키마 필드 정합", () => {
  const selection = (query: string, op: string): string[] => {
    const m = query.match(new RegExp(`${op}\\([^)]*\\)\\s*\\{([^}]*)\\}|${op}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`${op} 셀렉션을 찾지 못함`);
    return (m[1] ?? m[2]).split(/\s+/).filter(Boolean);
  };
  it.each([
    ["listMcpTokens", mcpQueries.LIST_MCP_TOKENS, "McpToken"],
    ["createMcpToken", mcpQueries.CREATE_MCP_TOKEN, "CreatedMcpToken"],
    ["revokeMcpToken", mcpQueries.REVOKE_MCP_TOKEN, "McpToken"],
  ])("%s 요청 필드 ⊆ %s", (op, query, typeName) => {
    const fields = schemaTypeFields(typeName as string);
    const missing = selection(query as string, op as string).filter((f) => !fields.has(f));
    expect(missing).toEqual([]);
  });
});

// 중첩 셀렉션({ ... })이 있는 단일 객체 반환 쿼리 — 균형 괄호로 셀렉션을 잘라 최상위 필드만 비교한다.
function balancedSelection(query: string, after: string): string {
  const start = query.indexOf("{", query.indexOf(after) + after.length);
  if (start < 0) throw new Error(`${after} 셀렉션을 찾지 못함`);
  let depth = 0;
  for (let i = start; i < query.length; i += 1) {
    if (query[i] === "{") depth += 1;
    if (query[i] === "}") depth -= 1;
    if (depth === 0) return query.slice(start + 1, i);
  }
  throw new Error("괄호 불균형");
}

/** `type <name>` 정확 일치(접두가 같은 다른 타입 — WorkspaceType 등 — 과 구분). */
function exactTypeFields(typeName: string): Set<string> {
  const m = schemaSdl.match(new RegExp(`type ${typeName}(?:\\s[^{]*)?\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`schema.graphql 에 type ${typeName} 없음`);
  return new Set(m[1].split("\n").map((l) => l.trim().match(/^(\w+)\s*(\(|:)/)?.[1]).filter((f): f is string => Boolean(f)));
}

function topLevelFields(selection: string): { fields: string[]; nested: Map<string, string> } {
  const nested = new Map<string, string>();
  let flat = "";
  for (let i = 0; i < selection.length; i += 1) {
    if (selection[i] !== "{") {
      flat += selection[i];
      continue;
    }
    const name = flat.trim().split(/\s+/).pop() ?? "";
    let depth = 0;
    let j = i;
    for (; j < selection.length; j += 1) {
      if (selection[j] === "{") depth += 1;
      if (selection[j] === "}") depth -= 1;
      if (depth === 0) break;
    }
    nested.set(name, selection.slice(i + 1, j));
    i = j;
  }
  return { fields: flat.split(/\s+/).filter(Boolean), nested };
}

describe("관리자 MCP 토큰·워크스페이스 MCP 정책 쿼리 ↔ 스키마 필드 정합", () => {
  it.each([
    ["adminListMcpTokens", mcpQueries.ADMIN_LIST_MCP_TOKENS, "items", "AdminMcpToken"],
    ["adminRevokeMcpToken", mcpQueries.ADMIN_REVOKE_MCP_TOKEN, "adminRevokeMcpToken(", "AdminMcpToken"],
    ["adminRevokeMcpTokensByMember", mcpQueries.ADMIN_REVOKE_MCP_TOKENS_BY_MEMBER, "items", "AdminMcpToken"],
    ["setWorkspaceMcpPolicy", workspaceQueries.SET_WORKSPACE_MCP_POLICY, "setWorkspaceMcpPolicy(", "Workspace"],
    ["listMyWorkspaces", workspaceQueries.LIST_MY_WORKSPACES, "listMyWorkspaces", "Workspace"],
  ])("%s 요청 필드 ⊆ %s", (_op, query, anchor, typeName) => {
    const { fields, nested } = topLevelFields(balancedSelection(query as string, anchor as string));
    const typeFields = exactTypeFields(typeName as string);
    expect(fields.filter((f) => !typeFields.has(f))).toEqual([]);
    if (nested.has("workspaces")) {
      const inner = topLevelFields(nested.get("workspaces") as string).fields;
      expect(inner.filter((f) => !exactTypeFields("McpTokenWorkspace").has(f))).toEqual([]);
    }
  });

  it("listMyWorkspaces 는 mcpPolicy 를 요청하고, listMcpTokens 는 관리자 폐기 표시 필드를 요청한다", () => {
    expect(workspaceQueries.LIST_MY_WORKSPACES).toContain("mcpPolicy");
    expect(mcpQueries.LIST_MCP_TOKENS).toMatch(/revokedByAdmin[\s\S]*revokeReason/);
  });
});
