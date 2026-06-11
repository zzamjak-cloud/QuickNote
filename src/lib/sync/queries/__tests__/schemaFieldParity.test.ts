// 클라이언트 쿼리가 요청하는 필드가 AppSync 스키마 타입에 없으면 해당 쿼리 전체가
// FieldUndefined 검증 에러로 거절된다(2026-06-11 PageMeta lastEditedBy* 누락 사고).
// 쿼리 필드 ⊆ 스키마 타입 필드 정합성을 빌드 시점에 강제한다.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIST_PAGES, LIST_PAGE_METAS } from "../page";

const schemaPath = resolve(__dirname, "../../../../../infra/lib/sync/schema.graphql");
const schemaSdl = readFileSync(schemaPath, "utf-8");

/** SDL 에서 type <name> { ... } 블록의 필드명 목록을 추출한다. */
function schemaTypeFields(typeName: string): Set<string> {
  const match = schemaSdl.match(
    new RegExp(`type ${typeName}[^{]*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`schema.graphql 에 type ${typeName} 없음`);
  const fields = new Set<string>();
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.trim().match(/^(\w+)\s*(\(|:)/);
    if (fieldMatch) fields.add(fieldMatch[1]);
  }
  return fields;
}

/** 쿼리 문자열의 items { ... } 선택 집합에서 요청 필드명을 추출한다. */
function requestedItemFields(query: string): string[] {
  const match = query.match(/items \{([^}]*)\}/);
  if (!match) throw new Error("쿼리에서 items 선택 집합을 찾지 못함");
  return match[1].split(/\s+/).filter(Boolean);
}

describe("클라이언트 쿼리 필드 ↔ schema.graphql 타입 정합성", () => {
  it("LIST_PAGE_METAS 가 요청하는 모든 필드는 PageMeta 타입에 존재한다", () => {
    const schemaFields = schemaTypeFields("PageMeta");
    const missing = requestedItemFields(LIST_PAGE_METAS).filter(
      (f) => !schemaFields.has(f),
    );
    expect(missing).toEqual([]);
  });

  it("LIST_PAGES 가 요청하는 모든 필드는 Page 타입에 존재한다", () => {
    const schemaFields = schemaTypeFields("Page");
    const missing = requestedItemFields(LIST_PAGES).filter(
      (f) => !schemaFields.has(f),
    );
    expect(missing).toEqual([]);
  });
});
