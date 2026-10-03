// QFM 노드 규약: 속성 태그(<bookmark/> 등) 사양과 qn-block 참조 id 헬퍼.
import type { DocNode } from "../types";
import { formatTagAttrs, isDangerousUrl, isSafeColor } from "./textEscape";

type AttrKind = "string" | "number" | "boolean";
type AttrSpec = { kind: AttrKind; default?: unknown };

export type AttrTagSpec = {
  tag: string;
  nodeType: string;
  inline: boolean;
  attrs: Record<string, AttrSpec>;
};

const str = (def?: unknown): AttrSpec => ({ kind: "string", default: def });
const num = (def?: unknown): AttrSpec => ({ kind: "number", default: def });
const bool = (def: boolean): AttrSpec => ({ kind: "boolean", default: def });

/** 마크다운 대응이 없는 원자 노드 — 속성을 그대로 태그 속성으로 직렬화(무손실, id 제외). */
export const ATTR_TAG_SPECS: AttrTagSpec[] = [
  {
    tag: "bookmark",
    nodeType: "bookmarkBlock",
    inline: false,
    attrs: {
      href: str(""), title: str(""), description: str(""), siteName: str(""),
      imageUrl: str(""), status: str("ready"), width: num(null),
    },
  },
  {
    tag: "file",
    nodeType: "fileBlock",
    inline: false,
    attrs: {
      src: str(null), name: str(null), size: num(null), mime: str(null),
      mimeType: str(null), contentType: str(null), width: num(null), height: num(null),
      uploading: bool(false), uploadId: str(null), uploadError: bool(false),
      align: str("left"), caption: str(null), captionAlign: str("left"),
    },
  },
  {
    tag: "youtube",
    nodeType: "youtube",
    inline: false,
    attrs: { src: str(null), start: num(0), width: num(560), height: num(315) },
  },
  {
    tag: "image",
    nodeType: "image",
    inline: false,
    attrs: {
      src: str(null), alt: str(null), title: str(null), width: num(null), height: num(null),
      align: str("left"), caption: str(null), captionAlign: str("left"),
      outlineWidth: num(0), outlineColor: str(null), borderRadius: num(0),
    },
  },
  {
    tag: "hr",
    nodeType: "horizontalRule",
    inline: false,
    attrs: { lineStyle: str("solid"), color: str(null), thickness: num(1) },
  },
  {
    tag: "button",
    nodeType: "buttonBlock",
    inline: true,
    attrs: { label: str("버튼"), href: str(""), databaseId: str(""), color: str("default") },
  },
  {
    tag: "icon",
    nodeType: "lucideInlineIcon",
    inline: true,
    attrs: { name: str("Circle"), color: str("#3f3f46") },
  },
  { tag: "inline-image", nodeType: "imageInlineIcon", inline: true, attrs: { src: str(null) } },
  // 기본값이 "오늘"(동적)이므로 항상 직렬화한다
  { tag: "date", nodeType: "dateInline", inline: true, attrs: { value: str(undefined) } },
];

export const ATTR_TAG_BY_TYPE = new Map(ATTR_TAG_SPECS.map((s) => [s.nodeType, s]));
export const ATTR_TAG_BY_TAG = new Map(ATTR_TAG_SPECS.map((s) => [s.tag, s]));

/** 원자 노드 → `<tag a="1"/>` (기본값·null 속성 생략). */
export function formatAttrTag(spec: AttrTagSpec, node: DocNode): string {
  const attrs = node.attrs ?? {};
  const pairs = Object.entries(spec.attrs).map(([name, def]): [string, string | undefined] => {
    const value = attrs[name];
    if (value === null || value === undefined || value === def.default) return [name, undefined];
    return [name, String(value)];
  });
  return `<${spec.tag}${formatTagAttrs(pairs)}/>`;
}

const URL_ATTRS = new Set(["src", "href", "imageUrl"]);
const COLOR_ATTRS = new Set(["color", "outlineColor"]);

/** URL 속성의 위험 스킴, 색 속성의 비허용 형식을 걸러낸다(블록·인라인 공용). */
function isSafeAttrValue(name: string, value: string): boolean {
  if (URL_ATTRS.has(name)) return !isDangerousUrl(value);
  if (COLOR_ATTRS.has(name)) return isSafeColor(value);
  return true;
}

// 이 속성이 없으면 노드가 무의미해 버린다
const REQUIRED_ATTR: Record<string, string> = {
  image: "src",
  youtube: "src",
  imageInlineIcon: "src",
  dateInline: "value",
};

export function hasRequiredAttrs(spec: AttrTagSpec, attrs: Record<string, unknown>): boolean {
  const required = REQUIRED_ATTR[spec.nodeType];
  return required === undefined || (typeof attrs[required] === "string" && attrs[required] !== "");
}

/** 태그 속성 레코드 → 노드 attrs (스펙에 있는 속성만, 타입 변환·안전성 검사). */
export function attrsFromTag(spec: AttrTagSpec, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(spec.attrs)) {
    const value = raw[name];
    if (value === undefined || !isSafeAttrValue(name, value)) continue;
    if (def.kind === "number") {
      const n = Number(value);
      if (value.trim() !== "" && Number.isFinite(n)) out[name] = n;
    } else if (def.kind === "boolean") {
      out[name] = value === "" || value.toLowerCase() === "true";
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** qn-block 로 대체되는 노드(마크다운 표현 불가). */
export const QN_BLOCK_TYPES = new Set([
  "tabBlock",
  "flowchartBlock",
  "dropdownMenuBlock",
  "galleryBlock",
]);

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** qn-block 참조 id — UniqueID `id` 우선, 없으면 공유 블록 식별자(flowchartId/sharedBlockId). */
export function blockRefId(node: DocNode): string | null {
  const attrs = node.attrs ?? {};
  return (
    nonEmptyString(attrs.id) ??
    nonEmptyString(attrs.flowchartId) ??
    nonEmptyString(attrs.sharedBlockId)
  );
}

/**
 * 원본 문서에서 qn-block / database 참조 맵을 만든다.
 * qfmToDoc 의 resolveBlockRef 로 `(id) => refs.get(id) ?? null` 처럼 넘긴다.
 * databaseBlock 은 databaseId 로도 색인해 panelState 등 표시 설정을 복원한다.
 */
export function collectBlockRefs(doc: DocNode | null | undefined): Map<string, DocNode> {
  const refs = new Map<string, DocNode>();
  const visit = (node: DocNode): void => {
    const ref = blockRefId(node);
    if (ref && !refs.has(ref)) refs.set(ref, node);
    if (node.type === "databaseBlock") {
      const dbId = nonEmptyString(node.attrs?.databaseId);
      if (dbId && !refs.has(dbId)) refs.set(dbId, node);
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (doc) visit(doc);
  return refs;
}
