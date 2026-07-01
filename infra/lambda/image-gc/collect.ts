// 자산 ref(quicknote-image:// / quicknote-file://) 도달성 수집 — 순수 로직.
export const SCHEMES = ["quicknote-image://", "quicknote-file://"];

// 문자열 내 임베드 ref 추출용 — JSON 직렬화된 doc/snapshot 문자열도 커버한다.
const EMBEDDED_REF_RE = /quicknote-(?:image|file):\/\/([^"'\\\s)}\]]+)/g;

export function collectFromValue(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const scheme of SCHEMES) {
      if (value.startsWith(scheme)) {
        out.add(value.slice(scheme.length));
        return;
      }
    }
    // JSON 문자열로 저장된 doc/snapshot 내부의 ref 도 도달 가능으로 취급.
    for (const m of value.matchAll(EMBEDDED_REF_RE)) out.add(m[1]);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as object)) collectFromValue(v, out);
  }
}
