export type HistoryBlockNode = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 키 순서 무관 직렬화 — 서버/클라이언트 입력 경로에 따른 키 순서 차이를 무시한다. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

export function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function hasMeaningfulNode(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.length > 0;
  }
  if (node.type !== "paragraph") return true;
  const content = node.content;
  return Array.isArray(content) && content.some(hasMeaningfulNode);
}

/** 빈 블럭(내용 없는 문단) — 추가/삭제를 변화로 치지 않는다. */
export function isEmptyBlockNode(node: unknown): boolean {
  if (!isPlainObject(node)) return true;
  if (node.type !== "paragraph") return false;
  return !hasMeaningfulNode(node);
}

/**
 * 시그니처용 노드 정규화 — attrs/marks 의 null 값 키를 깊이 제거한다.
 * editor.getJSON 과 y-prosemirror materialize 결과의 기본값 표현 차이를 흡수한다.
 */
export function normalizeForSignature(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForSignature);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "attrs" && isPlainObject(v)) {
      const attrs: Record<string, unknown> = {};
      for (const [attrKey, attrValue] of Object.entries(v)) {
        if (attrValue != null) attrs[attrKey] = normalizeForSignature(attrValue);
      }
      if (Object.keys(attrs).length > 0) out.attrs = attrs;
      continue;
    }
    if (v != null) out[key] = normalizeForSignature(v);
  }
  return out;
}

/** 블럭 시그니처: 타입 + (id 제외) attrs + content. 위치(index)는 포함하지 않는다. */
export function blockSignature(node: HistoryBlockNode): string {
  const normalized = normalizeForSignature(node) as Record<string, unknown>;
  const attrs = isPlainObject(normalized.attrs) ? { ...normalized.attrs } : {};
  delete attrs.id;
  return stableStringify({ type: normalized.type, attrs, content: normalized.content ?? null });
}
