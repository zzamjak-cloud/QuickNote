import type { Schema } from "@tiptap/pm/model";
import { Node } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";

/** 스키마 없이 TipTap JSON 구조 동치(히스토리·중복 updateDoc 방지용). */
export function jsonContentEquals(a: JSONContent, b: JSONContent): boolean {
  if (a.type !== b.type) return false;
  if ((a.text ?? "") !== (b.text ?? "")) return false;
  if (!marksShallowEqual(a.marks, b.marks)) return false;
  if (!attrsShallowEqual(a.attrs, b.attrs)) return false;
  const ac = a.content;
  const bc = b.content;
  if (!ac?.length && !bc?.length) return true;
  if (!ac || !bc || ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) {
    if (!jsonContentEquals(ac[i]!, bc[i]!)) return false;
  }
  return true;
}

function marksShallowEqual(
  a: JSONContent["marks"],
  b: JSONContent["marks"],
): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x?.type !== y?.type) return false;
    if (!attrsShallowEqual(x?.attrs, y?.attrs)) return false;
  }
  return true;
}

function attrsShallowEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (va != null && vb != null && typeof va === "object" && typeof vb === "object") {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
      continue;
    }
    return false;
  }
  return true;
}

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
