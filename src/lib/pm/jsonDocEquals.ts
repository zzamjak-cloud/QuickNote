import type { Schema } from "@tiptap/pm/model";
import { Node } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";

/**
 * 페이지 전환·동기화 시 JSON.stringify 대신 PM 노드 동치 비교.
 * 잘못된 JSON이면 false.
 */
export function tipTapJsonDocEquals(
  schema: Schema,
  a: JSONContent,
  b: JSONContent,
): boolean {
  try {
    const na = Node.fromJSON(schema, a as never);
    const nb = Node.fromJSON(schema, b as never);
    return na.eq(nb);
  } catch {
    return false;
  }
}
