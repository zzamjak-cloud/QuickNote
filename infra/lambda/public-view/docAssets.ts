// 페이지 doc(TipTap JSONContent)에서 참조된 자산 id(quicknote-image://, quicknote-file://)를 추출한다.
// op=asset presign 인가의 화이트리스트 — 여기서 수집되지 않은 assetId 는 절대 presign 하지 않는다.

const ASSET_SCHEMES = ["quicknote-image://", "quicknote-file://"] as const;
const MAX_DEPTH = 200;

function decodeAssetRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const scheme of ASSET_SCHEMES) {
    if (value.startsWith(scheme)) {
      const id = value.slice(scheme.length);
      return id.length > 0 ? id : null;
    }
  }
  return null;
}

/**
 * doc 트리 전체(attrs·marks 포함)를 순회하며 자산 ref id 집합을 반환한다.
 * extraValues 로 doc 밖 필드(icon, coverImage)도 함께 검사할 수 있다.
 */
export function collectDocAssetIds(
  doc: unknown,
  extraValues: Array<unknown> = [],
): Set<string> {
  const out = new Set<string>();
  for (const value of extraValues) {
    const id = decodeAssetRef(value);
    if (id) out.add(id);
  }
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    const attrs = rec.attrs;
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      for (const value of Object.values(attrs as Record<string, unknown>)) {
        const id = decodeAssetRef(value);
        if (id) out.add(id);
      }
    }
    if (Array.isArray(rec.content)) walk(rec.content, depth + 1);
    if (Array.isArray(rec.marks)) walk(rec.marks, depth + 1);
  };
  walk(doc, 0);
  return out;
}
