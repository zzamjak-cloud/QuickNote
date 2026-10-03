// 에디터 ProseMirror 스키마의 JSON 스냅샷 직렬화.
// 서버(infra Lambda)는 tiptap 확장을 번들할 수 없으므로, 이 스냅샷으로 기능적으로 동등한
// Schema 를 재구성해 fromJSON/check·y-prosemirror 변환에 사용한다.
// ⚠ infra 가 이 파일의 타입을 import 하므로 npm 패키지 import 를 두지 않는다(CI 는 infra 의존성만 설치).

export type AttrSpecJson = {
  hasDefault: boolean;
  default?: unknown;
};

export type NodeSpecJson = {
  name: string;
  content?: string;
  marks?: string;
  group?: string;
  inline?: boolean;
  atom?: boolean;
  attrs?: Record<string, AttrSpecJson>;
  selectable?: boolean;
  draggable?: boolean;
  code?: boolean;
  whitespace?: "pre" | "normal";
  defining?: boolean;
  definingAsContext?: boolean;
  definingForContent?: boolean;
  isolating?: boolean;
  linebreakReplacement?: boolean;
  tableRole?: string;
};

export type MarkSpecJson = {
  name: string;
  attrs?: Record<string, AttrSpecJson>;
  inclusive?: boolean;
  excludes?: string;
  group?: string;
  spanning?: boolean;
  code?: boolean;
};

export type EditorSchemaSpec = {
  version: 1;
  topNode: string;
  /** 클라 UniqueID 가 id 를 관리하는 노드 타입(EDITOR_UNIQUE_ID_TYPES). 서버 블록 diff·id 생성에 사용. */
  uniqueIdTypes: string[];
  nodes: NodeSpecJson[];
  marks: MarkSpecJson[];
};

// prosemirror-model Schema 의 구조적 최소 형태(패키지 import 회피용).
type SpecMap = { forEach(fn: (name: string, spec: Record<string, unknown>) => void): void };
export type SchemaLike = {
  spec: { nodes: SpecMap; marks: SpecMap; topNode?: string };
};

const NODE_FIELDS = [
  "content",
  "marks",
  "group",
  "inline",
  "atom",
  "selectable",
  "draggable",
  "code",
  "whitespace",
  "defining",
  "definingAsContext",
  "definingForContent",
  "isolating",
  "linebreakReplacement",
  "tableRole",
] as const;

const MARK_FIELDS = ["inclusive", "excludes", "group", "spanning", "code"] as const;

function pickFields(
  spec: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (spec[field] !== undefined) out[field] = spec[field];
  }
  return out;
}

function serializeAttrs(attrs: unknown): Record<string, AttrSpecJson> | undefined {
  if (!attrs || typeof attrs !== "object") return undefined;
  const entries = Object.entries(attrs as Record<string, Record<string, unknown>>);
  if (entries.length === 0) return undefined;
  const out: Record<string, AttrSpecJson> = {};
  for (const [name, attr] of entries) {
    const hasDefault = Object.prototype.hasOwnProperty.call(attr ?? {}, "default");
    const value = attr?.default;
    // 함수 기본값은 JSON 으로 재현 불가 — 조용히 누락하면 서버 스키마가 달라지므로 즉시 실패시킨다.
    if (typeof value === "function") {
      throw new Error(`editorSchemaSpec: attr "${name}" default is a function`);
    }
    out[name] = hasDefault ? { hasDefault, default: value } : { hasDefault };
  }
  return out;
}

/** Schema → JSON 스냅샷(노드·마크 순서 보존). 함수형 필드(toDOM/parseDOM 등)는 제외한다. */
export function serializeSchema(
  schema: SchemaLike,
  options: { uniqueIdTypes: readonly string[] },
): EditorSchemaSpec {
  const nodes: NodeSpecJson[] = [];
  schema.spec.nodes.forEach((name, spec) => {
    const attrs = serializeAttrs(spec.attrs);
    nodes.push({ name, ...pickFields(spec, NODE_FIELDS), ...(attrs ? { attrs } : {}) });
  });
  const marks: MarkSpecJson[] = [];
  schema.spec.marks.forEach((name, spec) => {
    const attrs = serializeAttrs(spec.attrs);
    marks.push({ name, ...pickFields(spec, MARK_FIELDS), ...(attrs ? { attrs } : {}) });
  });
  return {
    version: 1,
    topNode: schema.spec.topNode ?? "doc",
    uniqueIdTypes: [...options.uniqueIdTypes],
    nodes,
    marks,
  };
}
