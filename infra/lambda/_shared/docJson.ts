// ProseMirror JSON 순수 변환 헬퍼(서버 협업 편집용). 외부 패키지 의존 없음.
import { randomUUID } from "node:crypto";

export type DocJson = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocJson[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

// ── legacy columnLayout 보정(src/lib/collab/yjsDoc.ts normalizeLegacyJsonNode 포팅) ──
// infra 는 root 의존성(@tiptap 등)을 설치하지 않으므로 import 대신 동일 로직을 복제한다.
function normalizeLegacyColumnLayout(node: DocJson): DocJson | null {
  const attrs = node.attrs;
  const content = node.content;
  if (
    node.type !== "paragraph" ||
    !attrs ||
    typeof attrs.columns !== "number" ||
    !Array.isArray(content) ||
    content.length < 2 ||
    content.length > 6 ||
    !content.every((child) => child.type === "column")
  ) {
    return null;
  }
  return {
    type: "columnLayout",
    attrs: {
      columns: content.length,
      preset: typeof attrs.preset === "string" ? attrs.preset : "empty",
    },
    content,
  };
}

export function normalizeLegacyJsonNode(node: DocJson): DocJson {
  const source = normalizeLegacyColumnLayout(node) ?? node;
  if (!source.content) return source;
  return { ...source, content: source.content.map(normalizeLegacyJsonNode) };
}

// ── 블록 UniqueID(attrs.id) 처리 ──
// idTypes 는 "UniqueID 관리 + 블록(비인라인)" 타입만 담는다. pageLink.id·mention.id 같은
// 인라인 노드의 id 는 대상 페이지/멤버를 가리키는 의미값이라 절대 무시·생성하지 않는다.

/** 비교용: idTypes 노드의 attrs.id 를 재귀적으로 제거한 사본. */
export function stripBlockIds(node: DocJson, idTypes: ReadonlySet<string>): DocJson {
  let next = node;
  if (idTypes.has(node.type) && node.attrs && "id" in node.attrs) {
    const { id: _id, ...rest } = node.attrs;
    next = { ...node, attrs: rest };
  }
  if (!next.content) return next;
  return { ...next, content: next.content.map((child) => stripBlockIds(child, idTypes)) };
}

/**
 * 삽입용: idTypes 노드 중 id 가 없는(null/누락) 노드에 새 UUID 를 채운 사본.
 * ⚠ 클라 tiptap UniqueID 는 원격(y-sync$) 트랜잭션을 건너뛰므로, 서버가 넣은 블록의 id 를
 * 클라가 채워주지 않는다(로컬 편집이 그 범위를 건드릴 때까지 id=null). 그래서 서버에서 생성한다.
 */
export function fillMissingBlockIds(node: DocJson, idTypes: ReadonlySet<string>): DocJson {
  let next = node;
  if (idTypes.has(node.type) && (node.attrs?.id === undefined || node.attrs?.id === null)) {
    next = { ...node, attrs: { ...node.attrs, id: randomUUID() } };
  }
  if (!next.content) return next;
  return { ...next, content: next.content.map((child) => fillMissingBlockIds(child, idTypes)) };
}
